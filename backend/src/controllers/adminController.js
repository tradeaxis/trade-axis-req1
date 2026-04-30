// backend/src/controllers/adminController.js
const { supabase } = require('../config/supabase');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const kiteService = require('../services/kiteService');
const kiteStreamService = require('../services/kiteStreamService');
const tradingService = require('../services/tradingService');
const { fetchHolidaysFromKite } = require('../services/marketStatus');
const {
  getAllowedLeverageOptions,
  isAllowedLeverage,
} = require('../config/leverageOptions');
const { buildOpenTradeSnapshots } = require('../services/openTradeSnapshot');
const { fitTradeComment } = require('../utils/tradeCommentEvents');

// ============ HELPER: Generate Random Password ============
const generateTempPassword = () => {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
};

const buildAdminTradeComment = (prefix, note) => (
  fitTradeComment(`${prefix}: ${note || 'Manual admin action'}`)
);

const QR_SETTINGS_KEYS = ['qr_deposit_settings', 'qr_settings'];
const QR_DEPOSIT_REFERENCE_PREFIX = 'QRD';
const QR_DEPOSIT_DESCRIPTION_PREFIX = 'QR Deposit Request';

const firstNonEmptyString = (...values) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
};

const toBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on', 'enabled', 'active'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', 'disabled', 'inactive'].includes(normalized)) return false;
  }

  return fallback;
};

const parseAppSettingValue = (value) => {
  if (typeof value !== 'string') {
    return value ?? null;
  }

  try {
    return JSON.parse(value);
  } catch (_) {
    return value;
  }
};

const isQrDepositTransaction = (txn = {}) => {
  const reference = String(txn.reference || '').toUpperCase();
  if (reference.startsWith(QR_DEPOSIT_REFERENCE_PREFIX)) {
    return true;
  }

  const description = `${txn.description || ''} ${txn.note || ''}`.toLowerCase();
  return description.includes(QR_DEPOSIT_DESCRIPTION_PREFIX.toLowerCase());
};

const normalizeQrSettings = (raw = {}, fallback = {}) => {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw
    : {};
  const base = fallback && typeof fallback === 'object' && !Array.isArray(fallback)
    ? fallback
    : {};

  const qrImage = firstNonEmptyString(
    source.qrImage,
    source.qr_image,
    source.qrImageUrl,
    source.qr_image_url,
    source.image,
    source.imageUrl,
    source.image_url,
    typeof raw === 'string' ? raw : '',
    base.qrImage,
    base.qr_image,
    base.qrImageUrl,
    base.qr_image_url,
    base.image,
  );

  const upiId = firstNonEmptyString(
    source.upiId,
    source.upi_id,
    base.upiId,
    base.upi_id,
  );
  const merchantName = firstNonEmptyString(
    source.merchantName,
    source.merchant_name,
    source.accountHolderName,
    source.account_holder_name,
    base.merchantName,
    base.merchant_name,
    base.accountHolderName,
  );
  const accountName = firstNonEmptyString(
    source.accountName,
    source.account_name,
    source.accountHolderName,
    source.account_holder_name,
    base.accountName,
    base.account_name,
    base.accountHolderName,
  );
  const bankName = firstNonEmptyString(
    source.bankName,
    source.bank_name,
    base.bankName,
    base.bank_name,
  );
  const accountNumber = firstNonEmptyString(
    source.accountNumber,
    source.account_number,
    base.accountNumber,
    base.account_number,
  );
  const ifscCode = firstNonEmptyString(
    source.ifscCode,
    source.ifsc_code,
    base.ifscCode,
    base.ifsc_code,
  );
  const instructions = firstNonEmptyString(
    source.instructions,
    source.note,
    source.notes,
    source.description,
    base.instructions,
    base.note,
    base.notes,
  );
  const phoneNumber = firstNonEmptyString(
    source.phoneNumber,
    source.phone_number,
    source.whatsappNumber,
    source.whatsapp_number,
    base.phoneNumber,
    base.phone_number,
  );
  const enabled = toBoolean(
    source.enabled ?? source.isEnabled ?? source.active,
    toBoolean(base.enabled ?? base.isEnabled ?? base.active, !!(qrImage || upiId)),
  );

  return {
    ...base,
    ...source,
    enabled,
    isEnabled: enabled,
    active: enabled,
    qrImage,
    qr_image: qrImage,
    qrImageUrl: qrImage,
    qr_image_url: qrImage,
    image: qrImage,
    image_url: qrImage,
    upiId,
    upi_id: upiId,
    merchantName,
    merchant_name: merchantName,
    accountName,
    account_name: accountName,
    accountHolderName: accountName,
    account_holder_name: accountName,
    bankName,
    bank_name: bankName,
    accountNumber,
    account_number: accountNumber,
    ifscCode,
    ifsc_code: ifscCode,
    instructions,
    note: instructions,
    notes: instructions,
    phoneNumber,
    phone_number: phoneNumber,
  };
};

const readQrSettings = async () => {
  const { data, error } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', QR_SETTINGS_KEYS);

  if (error) throw error;

  const settingsByKey = new Map((data || []).map((row) => [row.key, parseAppSettingValue(row.value)]));

  for (const key of QR_SETTINGS_KEYS) {
    const value = settingsByKey.get(key);
    if (value) {
      return normalizeQrSettings(value);
    }
  }

  return normalizeQrSettings({});
};

const saveQrSettingsRecord = async (settings) => {
  const now = new Date().toISOString();
  const value = JSON.stringify(settings);

  for (const key of QR_SETTINGS_KEYS) {
    const { error } = await supabase
      .from('app_settings')
      .upsert(
        { key, value, updated_at: now },
        { onConflict: 'key' },
      );

    if (error) throw error;
  }

  return settings;
};

const recalculateAccountSnapshot = async (accountId, updatedAt = new Date().toISOString()) => {
  const { data: account, error: accountError } = await supabase
    .from('accounts')
    .select('balance, credit')
    .eq('id', accountId)
    .single();

  if (accountError || !account) {
    throw accountError || new Error('Account not found');
  }

  const { data: openTrades, error: openTradesError } = await supabase
    .from('trades')
    .select('profit, margin')
    .eq('account_id', accountId)
    .eq('status', 'open');

  if (openTradesError) throw openTradesError;

  const floatingProfit = (openTrades || []).reduce(
    (sum, row) => sum + Number(row.profit || 0),
    0,
  );
  const totalMargin = (openTrades || []).reduce(
    (sum, row) => sum + Number(row.margin || 0),
    0,
  );
  const balance = Number(account.balance || 0);
  const credit = Number(account.credit || 0);
  const equity = balance + credit + floatingProfit;
  const freeMargin = equity - totalMargin;

  const { error: updateError } = await supabase
    .from('accounts')
    .update({
      equity,
      margin: totalMargin,
      free_margin: freeMargin,
      updated_at: updatedAt,
    })
    .eq('id', accountId);

  if (updateError) throw updateError;

  return { balance, credit, floatingProfit, totalMargin, equity, freeMargin };
};

// ============ USER FUNCTIONS ============

exports.listUsers = async (req, res) => {
  try {
    const { q, limit = 500 } = req.query;
    const userSelect = [
      'id',
      'login_id',
      'email',
      'first_name',
      'last_name',
      'phone',
      'role',
      'is_active',
      'leverage',
      'brokerage_rate',
      'max_saved_accounts',
      'closing_mode',
      'liquidation_type',
      'created_at',
    ].join(', ');

    let query = supabase
      .from('users')
      .select(userSelect)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (q && q.trim()) {
      const searchTerm = q.trim().toLowerCase();
      query = query.or(`email.ilike.%${searchTerm}%,first_name.ilike.%${searchTerm}%,last_name.ilike.%${searchTerm}%,login_id.ilike.%${searchTerm}%`);
    }

    const { data: users, error } = await query;

    if (error) {
      console.error('listUsers query error:', error);
      throw error;
    }

    const userIds = (users || []).map((user) => user.id).filter(Boolean);
    let accountsByUserId = new Map();

    if (userIds.length > 0) {
      const { data: accounts, error: accountsError } = await supabase
        .from('accounts')
        .select('id, user_id, account_number, is_demo, balance, equity, margin, free_margin, leverage')
        .in('user_id', userIds);

      if (accountsError) {
        console.error('listUsers accounts query error:', accountsError);
        throw accountsError;
      }

      accountsByUserId = (accounts || []).reduce((map, account) => {
        const userAccountId = account.user_id;
        if (!map.has(userAccountId)) map.set(userAccountId, []);
        map.get(userAccountId).push({
          id: account.id,
          account_number: account.account_number,
          is_demo: account.is_demo,
          balance: account.balance,
          equity: account.equity,
          margin: account.margin,
          free_margin: account.free_margin,
          leverage: account.leverage,
        });
        return map;
      }, new Map());
    }

    const usersWithAccounts = (users || []).map((user) => ({
      id: user.id,
      login_id: user.login_id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      phone: user.phone,
      role: user.role || 'user',
      is_active: user.is_active !== false,
      leverage: user.leverage || 5,
      brokerage_rate: user.brokerage_rate || 0.0003,
      max_saved_accounts: user.max_saved_accounts || 3,
      closing_mode: user.closing_mode || false,
      liquidation_type: user.liquidation_type || 'liquidate',
      created_at: user.created_at,
      accounts: accountsByUserId.get(user.id) || [],
    }));

    res.json({ success: true, data: usersWithAccounts });
  } catch (error) {
    console.error('listUsers error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createUser = async (req, res) => {
  try {
    const { 
      loginId,
      password, 
      firstName, 
      lastName, 
      phone, 
      email,
      role = 'user',
      leverage = 30,
      brokerageRate = 0.0006,
      maxSavedAccounts = 10,
      demoBalance = 100000,
      createDemo = true,
      createLive = true,
      liquidationType = 'liquidate',
    } = req.body;
    const leverageNum = Number(leverage) || 30;
    const allowedLeverageOptions = getAllowedLeverageOptions();

    if (!loginId || !loginId.trim()) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }

    if (!createDemo && !createLive) {
      return res.status(400).json({ success: false, message: 'Select at least one account type' });
    }

    if (!isAllowedLeverage(leverageNum)) {
      return res.status(400).json({
        success: false,
        message: `Unsupported leverage 1:${leverageNum}. Allowed: ${allowedLeverageOptions.map((value) => `1:${value}`).join(', ')}`,
      });
    }

    const cleanLoginId = loginId.trim().toUpperCase();

    // Check if loginId already exists
    const { data: existingById } = await supabase
      .from('users')
      .select('id')
      .eq('login_id', cleanLoginId)
      .maybeSingle();

    if (existingById) {
      return res.status(400).json({ success: false, message: `User ID "${cleanLoginId}" already exists. Choose a different one.` });
    }

    // Also check user_id column
    const { data: existingByUserId } = await supabase
      .from('users')
      .select('id')
      .eq('user_id', cleanLoginId)
      .maybeSingle();

    if (existingByUserId) {
      return res.status(400).json({ success: false, message: `User ID "${cleanLoginId}" already exists. Choose a different one.` });
    }

    // If email provided, check uniqueness
    const userEmail = email ? email.toLowerCase().trim() : `${cleanLoginId.toLowerCase()}@tradeaxis.local`;
    
    if (email) {
      const { data: existingEmail } = await supabase
        .from('users')
        .select('id')
        .eq('email', userEmail)
        .maybeSingle();

      if (existingEmail) {
        return res.status(400).json({ success: false, message: 'Email already registered' });
      }
    }

    // Default password is TA2626
    const userPassword = password || 'TA1234';
    const hashedPassword = await bcrypt.hash(userPassword, 12);

    // must_change_password = true means first login will prompt password change
    const { data: user, error: userError } = await supabase
      .from('users')
      .insert([{
        user_id: cleanLoginId,
        login_id: cleanLoginId,
        email: userEmail,
        password_hash: hashedPassword,
        first_name: String(firstName || cleanLoginId).trim().substring(0, 50),
        last_name: String(lastName || '').trim().substring(0, 50),
        phone: String(phone || '').trim().substring(0, 15),
        role: (role || 'user').substring(0, 20),
        is_verified: false,
        is_active: true,
        max_saved_accounts: Number(maxSavedAccounts) || 10,
        closing_mode: false,
        must_change_password: true,
        liquidation_type: liquidationType || 'liquidate',
      }])
      .select()
      .single();

    if (userError) {
      console.error('Create user error:', JSON.stringify(userError));
      return res.status(500).json({ 
        success: false, 
        message: `Database error: ${userError.message}` 
      });
    }

    // Update optional fields separately (in case columns don't exist yet)
    try {
      await supabase
        .from('users')
        .update({
          leverage: leverageNum,
          brokerage_rate: Number(brokerageRate) || 0.0006,
        })
        .eq('id', user.id);
    } catch (e) {
      // silent — columns may not exist
    }

    // Create accounts
    const { generateAccountNumber } = require('../utils/auth');

    if (createDemo) {
      const accNum = generateAccountNumber(true);
      const { error: demoErr } = await supabase
        .from('accounts')
        .insert([{
          user_id: user.id,
          account_number: accNum.substring(0, 20),
          account_type: 'demo',
          is_demo: true,
          balance: Number(demoBalance) || 100000,
          equity: Number(demoBalance) || 100000,
          margin: 0,
          free_margin: Number(demoBalance) || 100000,
          leverage: leverageNum,
          currency: 'INR',
          is_active: true,
        }]);
      if (demoErr) console.error('Demo account error:', demoErr);
    }

    if (createLive) {
      const accNum = generateAccountNumber(false);
      const { error: liveErr } = await supabase
        .from('accounts')
        .insert([{
          user_id: user.id,
          account_number: accNum.substring(0, 20),
          account_type: 'standard',
          is_demo: false,
          balance: 0,
          equity: 0,
          margin: 0,
          free_margin: 0,
          leverage: leverageNum,
          currency: 'INR',
          is_active: true,
        }]);
      if (liveErr) console.error('Live account error:', liveErr);
    }

    res.json({ 
      success: true, 
      data: {
        user,
        loginId: cleanLoginId,
        tempPassword: userPassword === 'TA1234' ? 'TA1234' : null,
      },
      message: `User ${cleanLoginId} created successfully` 
    });
  } catch (error) {
    console.error('createUser full error:', error);
    res.status(500).json({ success: false, message: `Server error: ${error.message}` });
  }
};

exports.setUserActive = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    const { error } = await supabase
      .from('users')
      .update({ is_active: isActive })
      .eq('id', id);

    if (error) {
      console.error('setUserActive error:', error);
      return res.status(500).json({ success: false, message: error.message });
    }

    res.json({ success: true, message: `User ${isActive ? 'activated' : 'deactivated'}` });
  } catch (error) {
    console.error('setUserActive error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    const tempPassword = newPassword || generateTempPassword();

    if (tempPassword.length < 4) {
      return res.status(400).json({ success: false, message: 'Password must be at least 4 characters' });
    }

    const hashedPassword = await bcrypt.hash(tempPassword, 12);

    const { error } = await supabase
      .from('users')
      .update({ password_hash: hashedPassword })
      .eq('id', id);

    if (error) throw error;

    res.json({ 
      success: true, 
      data: { tempPassword },
      message: 'Password reset successfully' 
    });
  } catch (error) {
    console.error('resetPassword error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getLeverageOptions = async (req, res) => {
  res.json({
    success: true,
    options: getAllowedLeverageOptions(),
  });
};

exports.updateUserLeverage = async (req, res) => {
  try {
    const { id } = req.params;
    const { leverage, accountId } = req.body;

    if (!leverage || isNaN(Number(leverage))) {
      return res.status(400).json({ success: false, message: 'Valid leverage value is required' });
    }

    const leverageNum = Number(leverage);
    const allowedLeverageOptions = getAllowedLeverageOptions();

    if (!isAllowedLeverage(leverageNum)) {
      return res.status(400).json({
        success: false,
        message: `Unsupported leverage 1:${leverageNum}. Allowed: ${allowedLeverageOptions.map((value) => `1:${value}`).join(', ')}`,
      });
    }

    if (accountId) {
      const { error: accountError } = await supabase
        .from('accounts')
        .update({ leverage: leverageNum })
        .eq('id', accountId);

      if (accountError) {
        console.error('Update account leverage error:', accountError);
        const isConstraintError = /accounts_leverage_check/i.test(accountError.message || '');
        return res.status(500).json({ 
          success: false, 
          message: isConstraintError
            ? `Database leverage constraint rejected 1:${leverageNum}. Run the leverage DB update first or use one of: ${allowedLeverageOptions.map((value) => `1:${value}`).join(', ')}`
            : `Failed to update account leverage: ${accountError.message}`,
        });
      }
    } else {
      const { error: accountError } = await supabase
        .from('accounts')
        .update({ leverage: leverageNum })
        .eq('user_id', id);

      if (accountError) {
        console.error('Update accounts leverage error:', accountError);
        const isConstraintError = /accounts_leverage_check/i.test(accountError.message || '');
        return res.status(500).json({ 
          success: false, 
          message: isConstraintError
            ? `Database leverage constraint rejected 1:${leverageNum}. Run the leverage DB update first or use one of: ${allowedLeverageOptions.map((value) => `1:${value}`).join(', ')}`
            : `Failed to update accounts leverage: ${accountError.message}`,
        });
      }

      try {
        await supabase
          .from('users')
          .update({ leverage: leverageNum })
          .eq('id', id);
      } catch (userErr) {
        console.warn('User leverage column may not exist:', userErr.message);
      }
    }

    res.json({ success: true, message: `Leverage updated to 1:${leverageNum}` });
  } catch (error) {
    console.error('updateUserLeverage error:', error);
    res.status(500).json({ success: false, message: `Server error: ${error.message}` });
  }
};

exports.updateAccountEquity = async (req, res) => {
  try {
    const { id } = req.params;
    const { accountId, equity } = req.body;

    if (!accountId) {
      return res.status(400).json({ success: false, message: 'Account ID is required' });
    }

    if (equity === undefined || equity === null || Number.isNaN(Number(equity))) {
      return res.status(400).json({ success: false, message: 'Valid equity value is required' });
    }

    const targetEquity = Number(equity);

    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select('id, user_id')
      .eq('id', accountId)
      .eq('user_id', id)
      .single();

    if (accountError || !account) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    const processedAt = new Date().toISOString();
    const snapshot = await recalculateAccountSnapshot(account.id, processedAt);
    const newCredit = targetEquity - snapshot.balance - snapshot.floatingProfit;

    const { error: updateError } = await supabase
      .from('accounts')
      .update({
        credit: newCredit,
        updated_at: processedAt,
      })
      .eq('id', account.id);

    if (updateError) throw updateError;

    const updatedSnapshot = await recalculateAccountSnapshot(account.id, processedAt);

    res.json({
      success: true,
      message: `Equity updated to ${targetEquity.toFixed(2)}`,
      data: {
        equity: updatedSnapshot.equity,
        freeMargin: updatedSnapshot.freeMargin,
        margin: updatedSnapshot.totalMargin,
        credit: updatedSnapshot.credit,
      },
    });
  } catch (error) {
    console.error('updateAccountEquity error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateBrokerageRate = async (req, res) => {
  try {
    const { id } = req.params;
    const { brokerageRate } = req.body;

    const { error } = await supabase
      .from('users')
      .update({ brokerage_rate: Number(brokerageRate) })
      .eq('id', id);

    if (error) throw error;

    res.json({ success: true, message: 'Brokerage rate updated' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateMaxSavedAccounts = async (req, res) => {
  try {
    const { id } = req.params;
    const { maxSavedAccounts } = req.body;

    const { error } = await supabase
      .from('users')
      .update({ max_saved_accounts: Number(maxSavedAccounts) })
      .eq('id', id);

    if (error) throw error;

    res.json({ success: true, message: 'Max saved accounts updated' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.toggleClosingMode = async (req, res) => {
  try {
    const { id } = req.params;
    const { closingMode } = req.body;

    const { error } = await supabase
      .from('users')
      .update({ closing_mode: closingMode })
      .eq('id', id);

    if (error) throw error;

    res.json({ success: true, message: `Closing mode ${closingMode ? 'enabled' : 'disabled'}` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.addBalanceToAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const { accountId, amount, accountType = 'live', note = 'Admin deposit' } = req.body;

    if (!amount || amount === 0) {
      return res.status(400).json({ success: false, message: 'Invalid amount' });
    }

    const isReduction = amount < 0;
    const absAmount = Math.abs(amount);

    let account;

    if (accountId) {
      const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .eq('id', accountId)
        .single();

      if (error || !data) {
        return res.status(404).json({ success: false, message: 'Account not found' });
      }
      account = data;
    } else {
      const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .eq('user_id', id)
        .eq('is_demo', accountType === 'demo')
        .single();

      if (error || !data) {
        return res.status(404).json({ success: false, message: 'Account not found' });
      }
      account = data;
    }

    const currentBalance = parseFloat(account.balance || 0);

    // For reductions, validate sufficient balance
    if (isReduction && absAmount > currentBalance) {
      return res.status(400).json({
        success: false,
        message: `Cannot reduce ₹${absAmount}. Current balance is ₹${currentBalance.toFixed(2)}`,
      });
    }

    const currentCredit = parseFloat(account.credit || 0);
    const currentProfit = parseFloat(account.profit || 0);
    const newBalance = currentBalance + parseFloat(amount); // admin-controlled only
    const newEquity = newBalance + currentCredit + currentProfit;
    const newFreeMargin = newEquity - parseFloat(account.margin || 0);
    const processedAt = new Date().toISOString();
    const transactionType = isReduction ? 'withdrawal' : 'deposit';
    const description = note || (isReduction ? 'Admin reduction' : 'Admin deposit');

    const { error: updateError } = await supabase
      .from('accounts')
      .update({
        balance: newBalance,
        equity: newEquity,
        free_margin: newFreeMargin,
        updated_at: processedAt,
      })
      .eq('id', account.id);

    if (updateError) throw updateError;

    await supabase.from('transactions').insert({
      user_id: id,
      account_id: account.id,
      transaction_type: transactionType,
      type: transactionType,
      amount: absAmount,
      payment_method: 'bank_transfer',
      status: 'completed',
      reference: `ADM${Date.now().toString(36).toUpperCase()}`,
      balance_before: currentBalance,
      balance_after: newBalance,
      processed_at: processedAt,
      description,
    });

    res.json({
      success: true,
      message: isReduction
        ? `₹${absAmount} reduced from account. New balance: ₹${newBalance.toFixed(2)}`
        : `₹${absAmount} added to account. New balance: ₹${newBalance.toFixed(2)}`,
      newBalance,
    });
  } catch (error) {
    console.error('addBalanceToAccount error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============ DELETE USER ============
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user exists
    const { data: user, error: findError } = await supabase
      .from('users')
      .select('id, email, login_id')
      .eq('id', id)
      .single();

    if (findError || !user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Close all open trades first
    try {
      await supabase
        .from('trades')
        .update({ status: 'closed', close_time: new Date().toISOString() })
        .eq('user_id', id)
        .eq('status', 'open');
    } catch (e) {
      console.warn('Close trades error:', e.message);
    }

    // Delete pending orders
    try {
      await supabase.from('pending_orders').delete().eq('user_id', id);
    } catch (e) { /* table may not exist */ }

    // Delete transactions
    try {
      await supabase.from('transactions').delete().eq('user_id', id);
    } catch (e) {
      console.warn('Delete transactions error:', e.message);
    }

    // Delete trades
    try {
      await supabase.from('trades').delete().eq('user_id', id);
    } catch (e) {
      console.warn('Delete trades error:', e.message);
    }

    // Delete accounts
    try {
      await supabase.from('accounts').delete().eq('user_id', id);
    } catch (e) {
      console.warn('Delete accounts error:', e.message);
    }

    // Delete user
    const { error: deleteError } = await supabase
      .from('users')
      .delete()
      .eq('id', id);

    if (deleteError) {
      console.error('Delete user error:', deleteError);
      return res.status(500).json({ success: false, message: `Failed to delete user: ${deleteError.message}` });
    }

    res.json({ 
      success: true, 
      message: `User ${user.login_id || user.email} deleted successfully` 
    });
  } catch (error) {
    console.error('deleteUser error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============ WITHDRAWAL FUNCTIONS ============

exports.listWithdrawals = async (req, res) => {
  try {
    const { status } = req.query;

    let query = supabase
      .from('transactions')
      .select(`
        *,
        users:user_id (email, first_name, last_name, login_id),
        accounts:account_id (account_number, is_demo)
      `)
      .or('type.eq.withdrawal,transaction_type.eq.withdrawal')
      .order('created_at', { ascending: false });

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      console.error('listWithdrawals error:', error);
      throw error;
    }

    const withdrawals = (data || []).map(w => ({
      ...w,
      user_email: w.users?.email || '',
      user_name: w.users ? `${w.users.first_name || ''} ${w.users.last_name || ''}`.trim() : '',
      user_login_id: w.users?.login_id || '',
      account_number: w.accounts?.account_number || '',
      is_demo: w.accounts?.is_demo || false,
    }));

    res.json({ success: true, data: withdrawals });
  } catch (error) {
    console.error('listWithdrawals error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.approveWithdrawal = async (req, res) => {
  try {
    const { id } = req.params;
    const { adminNote } = req.body;

    const { data: txn, error: findError } = await supabase
      .from('transactions')
      .select('*')
      .eq('id', id)
      .single();

    if (findError || !txn) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    if (txn.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Transaction is not pending' });
    }

    const { error: updateError } = await supabase
      .from('transactions')
      .update({
        status: 'completed',
        admin_note: adminNote || 'Approved by admin',
        processed_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateError) throw updateError;

    res.json({ success: true, message: 'Withdrawal approved' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.rejectWithdrawal = async (req, res) => {
  try {
    const { id } = req.params;
    const { adminNote } = req.body;

    const { data: txn, error: findError } = await supabase
      .from('transactions')
      .select('*')
      .eq('id', id)
      .single();

    if (findError || !txn) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    if (txn.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Transaction is not pending' });
    }

    const { data: account } = await supabase
      .from('accounts')
      .select('*')
      .eq('id', txn.account_id)
      .single();

    if (account) {
      const newBalance = parseFloat(account.balance || 0) + parseFloat(txn.amount || 0);
      const newEquity = parseFloat(account.equity || 0) + parseFloat(txn.amount || 0);

      await supabase
        .from('accounts')
        .update({
          balance: newBalance,
          equity: newEquity,
          free_margin: newEquity - parseFloat(account.margin || 0),
        })
        .eq('id', txn.account_id);
    }

    const { error: updateError } = await supabase
      .from('transactions')
      .update({
        status: 'rejected',
        admin_note: adminNote || 'Rejected by admin',
        processed_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateError) throw updateError;

    res.json({ success: true, message: 'Withdrawal rejected and amount refunded' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.listQrDeposits = async (req, res) => {
  try {
    const { status } = req.query;

    let query = supabase
      .from('transactions')
      .select(`
        *,
        users:user_id (email, first_name, last_name, login_id),
        accounts:account_id (account_number, is_demo)
      `)
      .or('type.eq.deposit,transaction_type.eq.deposit')
      .order('created_at', { ascending: false })
      .limit(500);

    const { data, error } = await query;
    if (error) throw error;

    const deposits = (data || [])
      .filter((txn) => isQrDepositTransaction(txn))
      .filter((txn) => !status || status === 'all' || String(txn.status || '').toLowerCase() === String(status).toLowerCase())
      .map((txn) => ({
      ...txn,
      user_email: txn.users?.email || '',
      user_name: txn.users
        ? `${txn.users.first_name || ''} ${txn.users.last_name || ''}`.trim()
        : '',
      user_login_id: txn.users?.login_id || '',
      account_number: txn.accounts?.account_number || '',
      is_demo: txn.accounts?.is_demo || false,
    }));

    res.json({ success: true, data: deposits, deposits });
  } catch (error) {
    console.error('listQrDeposits error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getQrSettings = async (req, res) => {
  try {
    const settings = await readQrSettings();
    res.json({ success: true, data: settings, settings });
  } catch (error) {
    console.error('getQrSettings error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.saveQrSettings = async (req, res) => {
  try {
    const existingSettings = await readQrSettings();
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const settings = normalizeQrSettings(payload, existingSettings);
    const savedSettings = await saveQrSettingsRecord(settings);

    res.json({
      success: true,
      message: 'QR settings saved successfully',
      data: savedSettings,
      settings: savedSettings,
    });
  } catch (error) {
    console.error('saveQrSettings error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.approveQrDeposit = async (req, res) => {
  try {
    const { id } = req.params;
    const { adminNote } = req.body;

    const { data: txn, error: findError } = await supabase
      .from('transactions')
      .select('*')
      .eq('id', id)
      .single();

    if (findError || !txn) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }
    if (!isQrDepositTransaction(txn)) {
      return res.status(400).json({ success: false, message: 'Transaction is not a QR deposit request' });
    }
    if (txn.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Transaction is not pending' });
    }

    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select('*')
      .eq('id', txn.account_id)
      .single();

    if (accountError || !account) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    const currentBalance = Number(account.balance || 0);
    const amount = Number(txn.amount || 0);
    const newBalance = currentBalance + amount;
    const processedAt = new Date().toISOString();

    const { error: accountUpdateError } = await supabase
      .from('accounts')
      .update({
        balance: newBalance,
        updated_at: processedAt,
      })
      .eq('id', txn.account_id);

    if (accountUpdateError) throw accountUpdateError;

    await recalculateAccountSnapshot(txn.account_id, processedAt);

    const { error: txnUpdateError } = await supabase
      .from('transactions')
      .update({
        status: 'completed',
        admin_note: adminNote || 'QR deposit approved by admin',
        balance_before: currentBalance,
        balance_after: newBalance,
        processed_at: processedAt,
      })
      .eq('id', id);

    if (txnUpdateError) throw txnUpdateError;

    res.json({
      success: true,
      message: `QR deposit approved. New balance: INR ${newBalance.toFixed(2)}`,
      newBalance,
    });
  } catch (error) {
    console.error('approveQrDeposit error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.rejectQrDeposit = async (req, res) => {
  try {
    const { id } = req.params;
    const { adminNote } = req.body;

    const { data: txn, error: findError } = await supabase
      .from('transactions')
      .select('*')
      .eq('id', id)
      .single();

    if (findError || !txn) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }
    if (!isQrDepositTransaction(txn)) {
      return res.status(400).json({ success: false, message: 'Transaction is not a QR deposit request' });
    }
    if (txn.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Transaction is not pending' });
    }

    const { error: updateError } = await supabase
      .from('transactions')
      .update({
        status: 'rejected',
        admin_note: adminNote || 'QR deposit rejected by admin',
        processed_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateError) throw updateError;

    res.json({ success: true, message: 'QR deposit rejected' });
  } catch (error) {
    console.error('rejectQrDeposit error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============ PENDING ORDER STUBS ============
exports.modifyPendingOrder = async (req, res) => {
  res.json({ success: true, message: 'Not implemented' });
};

exports.cancelPendingOrder = async (req, res) => {
  res.json({ success: true, message: 'Not implemented' });
};

exports.cancelAllPendingOrders = async (req, res) => {
  res.json({ success: true, message: 'Not implemented' });
};

// ============ KITE CONNECT FUNCTIONS ============

exports.getKiteLoginUrl = async (req, res) => {
  try {
    await kiteService.init();

    if (!kiteService.isConfigured()) {
      return res.status(400).json({
        success: false,
        message: 'Kite API key/secret not configured in .env',
        instructions: [
          '1. Get API credentials from https://developers.kite.trade',
          '2. Add KITE_API_KEY and KITE_API_SECRET to backend/.env',
          '3. Restart the server',
        ],
      });
    }

    const loginUrl = kiteService.getLoginURL();

    res.json({
      success: true,
      loginUrl,
      instructions: [
        '1. Click the login URL and login with your Zerodha credentials',
        '2. After login, you will be redirected to a URL with request_token parameter',
        '3. Copy the request_token value from the URL',
        '4. Use the "Set Token" button to save it',
      ],
    });
  } catch (error) {
    console.error('getKiteLoginUrl error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createKiteSession = async (req, res) => {
  try {
    const { requestToken } = req.body;

    if (!requestToken) {
      return res.status(400).json({
        success: false,
        message: 'requestToken is required',
      });
    }

    const session = await kiteService.generateSession(requestToken.trim());

    // Log the token that's now in memory
    console.log('🔑 New token in memory (first 10):', kiteService.accessToken?.substring(0, 10) + '...');

    // Wait for DB write to complete (generateSession already called saveAccessTokenToDB 
    // but it's fire-and-forget inside generateSession — let's ensure it's done)
    await kiteService.saveAccessTokenToDB(kiteService.accessToken);
    console.log('💾 Token confirmed saved to DB');

    // ── AUTO-RESTART STREAM with new token ──────────────────────────
    let streamResult = null;
    try {
      // Stop existing stream (uses old expired token)
      console.log('🔄 Stopping old stream...');
      await kiteStreamService.stop();
      
      // Small delay to ensure clean disconnect
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Start fresh stream with new access token
      const io = req.app.get('io');
      if (io) {
        console.log('🔄 Starting stream with new token...');
        console.log('   In-memory token (first 10):', kiteService.accessToken?.substring(0, 10) + '...');
        streamResult = await kiteStreamService.start(io);
        console.log('✅ Stream restarted:', streamResult);
      }
    } catch (streamErr) {
      console.warn('⚠️ Stream restart failed:', streamErr.message);
    }

    // ── AUTO-SYNC instruments ───────────────────────────────────────
    let syncResult = null;
    try {
      const { syncKiteInstruments } = require('../utils/syncKiteInstruments');
      syncResult = await syncKiteInstruments();
      if (syncResult.success && syncResult.upserted > 0) {
        console.log(`📊 Auto-synced ${syncResult.upserted} instruments`);
        await kiteStreamService.refreshSubscriptions();
      }
    } catch (syncErr) {
      console.warn('⚠️ Auto-sync failed:', syncErr.message);
    }

    let holidayResult = null;
    try {
      const holidays = await fetchHolidaysFromKite();
      holidayResult = { fetched: true, count: holidays.length };
    } catch (holidayErr) {
      console.warn('⚠️ Holiday refresh failed:', holidayErr.message);
      holidayResult = { fetched: false, count: 0, message: holidayErr.message };
    }

    res.json({
      success: true,
      message: 'Kite session created successfully! Stream restarted. Token valid until tomorrow 6 AM IST.',
      userId: session.userId,
      createdAt: session.createdAt,
      stream: streamResult,
      sync: syncResult,
      holidays: holidayResult,
    });
  } catch (error) {
    console.error('createKiteSession error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.syncKiteSymbols = async (req, res) => {
  try {
    await kiteService.init();

    if (!kiteService.isSessionReady()) {
      return res.status(400).json({
        success: false,
        message: 'Kite session not ready. Please create session first.',
      });
    }

    const { syncKiteInstruments } = require('../utils/syncKiteInstruments');
    const result = await syncKiteInstruments();

    if (result.success && result.upserted > 0) {
      try {
        await kiteStreamService.refreshSubscriptions();
      } catch (refreshErr) {
        console.warn('⚠️ Stream refresh failed after manual sync:', refreshErr.message);
      }
    }

    res.json({
      success: true,
      message: `Synced ${result.upserted || 0} symbols from ${result.underlyings || 0} underlyings`,
      ...result,
    });
  } catch (error) {
    console.error('syncKiteSymbols error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.startKiteStream = async (req, res) => {
  try {
    const io = req.app.get('io');

    if (!io) {
      return res.status(500).json({ success: false, message: 'Socket.IO not available' });
    }

    const result = await kiteStreamService.start(io);

    if (result.started) {
      res.json({
        success: true,
        message: `Kite stream started with ${result.underlyingCount || result.tokens} live symbols`,
        ...result,
      });
    } else {
      res.status(400).json({
        success: false,
        message: `Stream not started: ${result.reason}`,
        ...result,
      });
    }
  } catch (error) {
    console.error('startKiteStream error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.stopKiteStream = async (req, res) => {
  try {
    const result = await kiteStreamService.stop();
    res.json({ success: true, message: 'Kite stream stopped', ...result });
  } catch (error) {
    console.error('stopKiteStream error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.kiteStatus = async (req, res) => {
  try {
    await kiteService.init();

    const streamStatus = kiteStreamService.status();
    const sessionReady = kiteService.isSessionReady();
    const configured = kiteService.isConfigured();

    let profileValid = false;
    let profile = null;

    if (sessionReady && kiteService.kc) {
      try {
        profile = await kiteService.kc.getProfile();
        profileValid = true;
      } catch (err) {
        profileValid = false;
      }
    }

    res.json({
      success: true,
      configured,
      sessionReady,
      profileValid,
      profile: profile
        ? {
            userName: profile.user_name,
            email: profile.email,
            userId: profile.user_id,
          }
        : null,
      stream: streamStatus,
    });
  } catch (error) {
    console.error('kiteStatus error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============ MARKET HOLIDAY TOGGLE ============
exports.setMarketHoliday = async (req, res) => {
  try {
    const { isHoliday, message, date } = req.body;
    const marketStatus = require('../services/marketStatus');

    if (
      typeof marketStatus.setHoliday !== 'function' ||
      typeof marketStatus.getHolidayStatus !== 'function'
    ) {
      return res.status(500).json({
        success: false,
        message: 'marketStatus service is misconfigured',
      });
    }

    marketStatus.setHoliday(!!isHoliday, message || '', date || null);

    const status = marketStatus.getHolidayStatus();
    res.json({
      success: true,
      data: status,
      message: status.isHoliday
        ? `Market holiday enabled: ${status.message || 'Holiday active'}`
        : 'Market holiday disabled. Normal trading resumed.',
    });
  } catch (error) {
    console.error('setMarketHoliday error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getMarketHoliday = async (req, res) => {
  try {
    const marketStatus = require('../services/marketStatus');

    if (typeof marketStatus.getHolidayStatus !== 'function' || typeof marketStatus.isMarketOpen !== 'function') {
      return res.status(500).json({
        success: false,
        message: 'marketStatus service is misconfigured',
      });
    }

    const status = marketStatus.getHolidayStatus();

    res.json({
      success: true,
      data: {
        ...status,
        marketOpen: marketStatus.isMarketOpen(),
      },
    });
  } catch (error) {
    console.error('getMarketHoliday error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============ ADMIN MANUAL CLOSE POSITION ============
exports.adminClosePosition = async (req, res) => {
  try {
    const { tradeId, closePrice: manualPrice, reason } = req.body;

    if (!tradeId) {
      return res.status(400).json({ success: false, message: 'Trade ID is required' });
    }

    // Get the trade
    const { data: trade, error: tradeError } = await supabase
      .from('trades')
      .select('*, accounts!inner(user_id)')
      .eq('id', tradeId)
      .eq('status', 'open')
      .single();

    if (tradeError || !trade) {
      return res.status(404).json({ success: false, message: 'Trade not found or already closed' });
    }

    const preview = await tradingService.previewClosePosition(trade, {
      closePrice: manualPrice && Number(manualPrice) > 0 ? Number(manualPrice) : undefined,
    });

    if (!preview.success) {
      return res.status(400).json({
        success: false,
        message: preview.message || 'Cannot determine close price',
      });
    }

    const closeTime = new Date().toISOString();

    // Close the trade
    const { data: closedTrade, error: updateError } = await supabase
      .from('trades')
      .update({
        close_price: preview.closePrice,
        profit: preview.netProfit,
        sell_brokerage: preview.sellBrokerage,
        brokerage: preview.totalBrokerage,
        status: 'closed',
        close_time: closeTime,
        updated_at: closeTime,
        comment: buildAdminTradeComment('Admin close', reason || 'Manual close by admin'),
      })
      .eq('id', tradeId)
      .select()
      .single();

    if (updateError) throw updateError;

    await tradingService.settleAccount(
      trade.account_id,
      preview.netProfit,
      preview.marginFreed,
      closeTime,
    );

    res.json({
      success: true,
      data: closedTrade,
      message: `Admin closed ${trade.symbol} ${trade.trade_type.toUpperCase()} x${Number(trade.quantity || 0)} @ Rs.${preview.closePrice.toFixed(2)}. P&L: Rs.${preview.netProfit.toFixed(2)}`,
    });
  } catch (error) {
    console.error('adminClosePosition error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============ GET ALL OPEN POSITIONS (admin) ============
exports.getAllOpenPositions = async (req, res) => {
  try {
    const { data: trades, error } = await supabase
      .from('trades')
      .select('id, symbol, exchange, trade_type, quantity, open_price, current_price, profit, margin, brokerage, buy_brokerage, user_id, account_id, open_time, stop_loss, take_profit, comment')
      .eq('status', 'open')
      .order('open_time', { ascending: false })
      .limit(500);

    if (error) throw error;

    const userIds = [...new Set((trades || []).map((t) => t.user_id))];

    let userMap = {};
    if (userIds.length > 0) {
      const { data: users } = await supabase
        .from('users')
        .select('id, login_id')
        .in('id', userIds);

      (users || []).forEach((u) => {
        userMap[u.id] = u.login_id;
      });
    }

    const liveTrades = await buildOpenTradeSnapshots(trades || []);

    const enriched = liveTrades.map((t) => ({
      ...t,
      user_login_id: userMap[t.user_id] || '—',
    }));

    res.json({ success: true, data: enriched });
  } catch (error) {
    console.error('getAllOpenPositions error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============ GET OPEN POSITIONS OF SPECIFIC USER ============
exports.getUserOpenPositions = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }

    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id, login_id, first_name, last_name')
      .eq('id', userId)
      .single();

    if (userErr || !user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const { data: trades, error } = await supabase
      .from('trades')
      .select('id, symbol, exchange, trade_type, quantity, open_price, current_price, profit, margin, brokerage, buy_brokerage, user_id, account_id, open_time, stop_loss, take_profit, comment')
      .eq('status', 'open')
      .eq('user_id', userId)
      .order('open_time', { ascending: false });

    if (error) throw error;

    const liveTrades = await buildOpenTradeSnapshots(trades || []);

    const enriched = liveTrades.map((t) => ({
      ...t,
      user_login_id: user.login_id || '—',
      user_name: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
    }));

    res.json({ success: true, user, data: enriched });
  } catch (error) {
    console.error('getUserOpenPositions error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============ CLOSE ALL OPEN POSITIONS OF SPECIFIC USER ============
exports.adminCloseAllUserPositions = async (req, res) => {
  try {
    const { userId, closePrice: manualPrice, reason } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }

    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id, login_id')
      .eq('id', userId)
      .single();

    if (userErr || !user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const { data: trades, error: tradesErr } = await supabase
      .from('trades')
      .select('*, accounts!inner(user_id)')
      .eq('status', 'open')
      .eq('user_id', userId);

    if (tradesErr) throw tradesErr;

    if (!trades || trades.length === 0) {
      return res.status(400).json({ success: false, message: 'No open positions for selected user' });
    }

    let closedCount = 0;

    for (const trade of trades) {
      try {
        const preview = await tradingService.previewClosePosition(trade, {
          closePrice: manualPrice && Number(manualPrice) > 0 ? Number(manualPrice) : undefined,
        });

        if (!preview.success) continue;

        const closeTime = new Date().toISOString();

        const { error: updateError } = await supabase
          .from('trades')
          .update({
            close_price: preview.closePrice,
            profit: preview.netProfit,
            sell_brokerage: preview.sellBrokerage,
            brokerage: preview.totalBrokerage,
            status: 'closed',
            close_time: closeTime,
            updated_at: closeTime,
            comment: buildAdminTradeComment('Admin close all', reason || 'Manual close by admin'),
          })
          .eq('id', trade.id);

        if (updateError) throw updateError;

        await tradingService.settleAccount(
          trade.account_id,
          preview.netProfit,
          preview.marginFreed,
          closeTime,
        );

        closedCount++;
      } catch (innerErr) {
        console.error('adminCloseAllUserPositions trade close error:', innerErr.message);
      }
    }

    res.json({
      success: true,
      closedCount,
      message: `Closed ${closedCount} position(s) for ${user.login_id}`,
    });
  } catch (error) {
    console.error('adminCloseAllUserPositions error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.adminUpdatePosition = async (req, res) => {
  try {
    const { tradeId } = req.params;
    const {
      quantity,
      openPrice,
      currentPrice,
      stopLoss,
      takeProfit,
      comment,
    } = req.body || {};

    if (!tradeId) {
      return res.status(400).json({ success: false, message: 'Trade ID is required' });
    }

    const { data: trade, error: tradeError } = await supabase
      .from('trades')
      .select('*, accounts!inner(user_id, leverage)')
      .eq('id', tradeId)
      .eq('status', 'open')
      .single();

    if (tradeError || !trade) {
      return res.status(404).json({ success: false, message: 'Trade not found or already closed' });
    }

    const nextQuantity = quantity !== undefined && quantity !== null && quantity !== ''
      ? Number(quantity)
      : Number(trade.quantity || 0);
    const nextOpenPrice = openPrice !== undefined && openPrice !== null && openPrice !== ''
      ? Number(openPrice)
      : Number(trade.open_price || 0);
    const nextCurrentPrice = currentPrice !== undefined && currentPrice !== null && currentPrice !== ''
      ? Number(currentPrice)
      : Number(trade.current_price || trade.open_price || 0);

    if (!Number.isFinite(nextQuantity) || nextQuantity <= 0) {
      return res.status(400).json({ success: false, message: 'Quantity must be greater than 0' });
    }
    if (!Number.isFinite(nextOpenPrice) || nextOpenPrice <= 0) {
      return res.status(400).json({ success: false, message: 'Open price must be greater than 0' });
    }
    if (!Number.isFinite(nextCurrentPrice) || nextCurrentPrice <= 0) {
      return res.status(400).json({ success: false, message: 'Current price must be greater than 0' });
    }

    const lotSize = Number(trade.lot_size || 1) || 1;
    const leverage = Number(trade.accounts?.leverage || 5) || 5;
    const brokerageRate = await tradingService.getBrokerageRate(trade.user_id);
    const nextMargin = (nextOpenPrice * nextQuantity * lotSize) / leverage;
    const nextBuyBrokerage = nextOpenPrice * nextQuantity * lotSize * brokerageRate;
    const direction = trade.trade_type === 'buy' ? 1 : -1;
    const nextProfit = ((nextCurrentPrice - nextOpenPrice) * direction * nextQuantity * lotSize) - nextBuyBrokerage;
    const updatedAt = new Date().toISOString();

    const updates = {
      quantity: nextQuantity,
      open_price: nextOpenPrice,
      current_price: nextCurrentPrice,
      margin: nextMargin,
      buy_brokerage: nextBuyBrokerage,
      brokerage: nextBuyBrokerage,
      profit: nextProfit,
      updated_at: updatedAt,
    };

    if (stopLoss !== undefined) updates.stop_loss = Number(stopLoss) || 0;
    if (takeProfit !== undefined) updates.take_profit = Number(takeProfit) || 0;
    if (comment !== undefined) updates.comment = fitTradeComment(comment);

    const { data: updatedTrade, error: updateError } = await supabase
      .from('trades')
      .update(updates)
      .eq('id', tradeId)
      .select()
      .single();

    if (updateError) throw updateError;

    await recalculateAccountSnapshot(trade.account_id, updatedAt);

    res.json({
      success: true,
      data: updatedTrade,
      message: `Position ${trade.symbol} updated successfully`,
    });
  } catch (error) {
    console.error('adminUpdatePosition error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.adminDeletePosition = async (req, res) => {
  try {
    const { tradeId } = req.params;

    if (!tradeId) {
      return res.status(400).json({ success: false, message: 'Trade ID is required' });
    }

    const { data: trade, error: tradeError } = await supabase
      .from('trades')
      .select('id, symbol, account_id')
      .eq('id', tradeId)
      .eq('status', 'open')
      .single();

    if (tradeError || !trade) {
      return res.status(404).json({ success: false, message: 'Trade not found or already closed' });
    }

    const { error: deleteError } = await supabase
      .from('trades')
      .delete()
      .eq('id', tradeId);

    if (deleteError) throw deleteError;

    await recalculateAccountSnapshot(trade.account_id);

    res.json({
      success: true,
      message: `Position ${trade.symbol} deleted successfully`,
    });
  } catch (error) {
    console.error('adminDeletePosition error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============ ADMIN SCRIPT BAN ============
exports.toggleSymbolBan = async (req, res) => {
  try {
    const { symbol, isBanned, reason } = req.body;
    
    if (!symbol) {
      return res.status(400).json({ success: false, message: 'Symbol is required' });
    }

    const { error } = await supabase
      .from('symbols')
      .update({ 
        is_banned: !!isBanned, 
        ban_reason: reason || '',
        updated_at: new Date().toISOString() 
      })
      .eq('symbol', symbol.toUpperCase());

    if (error) throw error;

    res.json({ 
      success: true, 
      message: `${symbol} ${isBanned ? 'BANNED' : 'UNBANNED'} for trading` 
    });
  } catch (error) {
    console.error('toggleSymbolBan error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============ DATA CLEANUP ============
exports.cleanupOldData = async (req, res) => {
  try {
    const { months = 3 } = req.body;
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - Number(months));
    const cutoff = cutoffDate.toISOString();

    const results = {};

    // Delete closed trades
    const { data: trades, error: tradeErr } = await supabase
      .from('trades')
      .delete()
      .eq('status', 'closed')
      .lt('close_time', cutoff)
      .select('id');

    results.deletedTrades = trades?.length || 0;
    if (tradeErr) results.tradeError = tradeErr.message;

    // Delete completed/rejected transactions
    const { data: txns, error: txnErr } = await supabase
      .from('transactions')
      .delete()
      .in('status', ['completed', 'rejected'])
      .lt('created_at', cutoff)
      .select('id');

    results.deletedTransactions = txns?.length || 0;
    if (txnErr) results.txnError = txnErr.message;

    // Delete old settlements
    try {
      const { data: settlements } = await supabase
        .from('weekly_settlements')
        .delete()
        .lt('created_at', cutoff)
        .select('id');
      results.deletedSettlements = settlements?.length || 0;
    } catch (e) {
      results.deletedSettlements = 0;
    }

    console.log(`🧹 Cleanup: ${results.deletedTrades} trades, ${results.deletedTransactions} txns, ${results.deletedSettlements} settlements (cutoff: ${cutoff})`);

    res.json({
      success: true,
      message: `Cleaned up data older than ${months} months`,
      cutoff,
      ...results,
    });
  } catch (error) {
    console.error('cleanupOldData error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============ FORCE DELETE EXPIRED TOKEN ============
exports.deleteExpiredToken = async (req, res) => {
  try {
    await supabase
      .from('app_settings')
      .update({ value: '', updated_at: new Date().toISOString() })
      .eq('key', 'kite_access_token');

    kiteService.accessToken = null;
    kiteService.initialized = false;

    await kiteStreamService.stop();

    res.json({
      success: true,
      message: 'Token deleted and stream stopped. Create new session to resume.',
    });
  } catch (error) {
    console.error('deleteExpiredToken error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
