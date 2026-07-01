// backend/src/controllers/adminController.js
const { supabase } = require('../config/supabase');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const kiteService = require('../services/kiteService');
const kiteStreamService = require('../services/kiteStreamService');
const angelOneStreamService = require('../services/angelOneStreamService');
const closePriceSnapshotService = require('../services/closePriceSnapshotService');
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

const rememberPlainPassword = async (userId, plainPassword) => {
  if (!userId || !plainPassword) return;

  const { error } = await supabase
    .from('users')
    .update({ plain_password: String(plainPassword) })
    .eq('id', userId);

  if (error && !/plain_password|schema cache|column/i.test(`${error.message || ''} ${error.details || ''}`)) {
    console.warn('plain password mirror update skipped:', error.message);
  }
};

const buildAdminTradeComment = (prefix, note) => (
  fitTradeComment(`${prefix}: ${note || 'Manual admin action'}`)
);

const KITE_AUTH_SETTINGS_KEY = 'kite_auth_settings';
const DEFAULT_KITE_AUTH_SETTINGS = {
  tokenMode: 'automatic',
  automatic: true,
  activeProvider: 'kite',
  providers: {
    kite: {
      enabled: true,
      label: 'Kite',
    },
    truedata: {
      enabled: false,
      label: 'TrueData',
      userId: '',
      token: '',
      websocketUrl: '',
    },
    angelone: {
      enabled: false,
      label: 'Angel One',
      apiKey: '',
      clientCode: '',
      redirectUrl: 'https://dashboard.tradeaxis.in',
      jwtToken: '',
      feedToken: '',
    },
  },
};

const normalizeKiteAuthSettings = (value = {}) => {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const tokenMode = source.tokenMode === 'manual' || source.mode === 'manual' ? 'manual' : 'automatic';
  const providerKeys = new Set(['kite', 'truedata', 'angelone']);
  const activeProvider = providerKeys.has(String(source.activeProvider || '').toLowerCase())
    ? String(source.activeProvider).toLowerCase()
    : 'kite';
  const incomingProviders = source.providers && typeof source.providers === 'object' ? source.providers : {};
  const providers = Object.fromEntries(Object.entries(DEFAULT_KITE_AUTH_SETTINGS.providers).map(([key, defaults]) => ([
    key,
    {
      ...defaults,
      ...(incomingProviders[key] && typeof incomingProviders[key] === 'object' ? incomingProviders[key] : {}),
      enabled: toBoolean(incomingProviders[key]?.enabled, defaults.enabled),
    },
  ])));

  return {
    ...DEFAULT_KITE_AUTH_SETTINGS,
    ...source,
    tokenMode,
    automatic: tokenMode === 'automatic',
    activeProvider,
    providers,
  };
};

const sanitizeKiteAuthSettings = (value = {}) => {
  const settings = normalizeKiteAuthSettings(value);
  const angel = settings.providers?.angelone || {};
  const truedata = settings.providers?.truedata || {};
  return {
    ...settings,
    providers: {
      ...settings.providers,
      truedata: {
        ...truedata,
        token: '',
        tokenConfigured: Boolean(truedata.token),
      },
      angelone: {
        ...angel,
        jwtToken: '',
        feedToken: '',
        sessionReady: Boolean(angel.jwtToken && angel.feedToken),
      },
    },
  };
};

const QR_SETTINGS_KEYS = ['qr_deposit_settings', 'qr_settings'];
const QR_DEPOSIT_REFERENCE_PREFIX = 'QRD';
const QR_DEPOSIT_DESCRIPTION_PREFIX = 'QR Deposit Request';
const REJECTED_TRANSACTION_STATUSES = ['rejected', 'failed'];

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

const isCheckConstraintError = (error, expectedConstraint = '') => {
  const message = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (error?.code === '23514') {
    return !expectedConstraint || message.includes(String(expectedConstraint).toLowerCase());
  }

  return (
    message.includes('check constraint') &&
    (!expectedConstraint || message.includes(String(expectedConstraint).toLowerCase()))
  );
};

const getTransactionStatusAliases = (status) => {
  const normalized = String(status || '').trim().toLowerCase();
  if (!normalized || normalized === 'all') {
    return [];
  }

  if (REJECTED_TRANSACTION_STATUSES.includes(normalized)) {
    return REJECTED_TRANSACTION_STATUSES;
  }

  return [normalized];
};

const applyTransactionStatusFilter = (query, status) => {
  const statuses = getTransactionStatusAliases(status);
  if (!statuses.length) {
    return query;
  }

  if (statuses.length === 1) {
    return query.eq('status', statuses[0]);
  }

  return query.in('status', statuses);
};

const matchesTransactionStatus = (candidateStatus, expectedStatus) => {
  const expectedValues = getTransactionStatusAliases(expectedStatus);
  if (!expectedValues.length) {
    return true;
  }

  return expectedValues.includes(String(candidateStatus || '').trim().toLowerCase());
};

const updateTransactionAsRejected = async (id, payload = {}) => {
  let lastError = null;
  const processedAt = payload.processed_at || new Date().toISOString();

  for (const status of REJECTED_TRANSACTION_STATUSES) {
    const { error } = await supabase
      .from('transactions')
      .update({
        ...payload,
        status,
        processed_at: processedAt,
      })
      .eq('id', id);

    if (!error) {
      return { status, processedAt };
    }

    lastError = error;
    if (!isCheckConstraintError(error, 'transactions_status_check')) {
      throw error;
    }
  }

  throw lastError;
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

const recalculateOpenTradeMarginsForLeverage = async (accountIds, leverageNum, updatedAt = new Date().toISOString()) => {
  const ids = [...new Set((Array.isArray(accountIds) ? accountIds : [accountIds]).filter(Boolean))];
  if (!ids.length) return;

  const { data: trades, error } = await supabase
    .from('trades')
    .select('id, account_id, quantity, lot_size, open_price')
    .in('account_id', ids)
    .eq('status', 'open');

  if (error) throw error;

  for (const trade of trades || []) {
    const qty = Number(trade.quantity || 0);
    const lotSize = Number(trade.lot_size || 1) || 1;
    const openPrice = Number(trade.open_price || 0);
    const margin = leverageNum > 0 ? (openPrice * qty * lotSize) / leverageNum : 0;

    const { error: updateError } = await supabase
      .from('trades')
      .update({ margin, updated_at: updatedAt })
      .eq('id', trade.id);

    if (updateError) throw updateError;
  }

  for (const accountId of ids) {
    await recalculateAccountSnapshot(accountId, updatedAt);
  }
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
        liquidation_type: liquidationType === 'illiquidate' ? 'illiquidate' : 'liquidate',
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

    await rememberPlainPassword(user.id, userPassword);

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
    await rememberPlainPassword(id, tempPassword);

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

    let accountIdsToRecalculate = [];
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
      accountIdsToRecalculate = [accountId];
    } else {
      const { data: accountRows, error: fetchAccountsError } = await supabase
        .from('accounts')
        .select('id')
        .eq('user_id', id);

      if (fetchAccountsError) throw fetchAccountsError;
      accountIdsToRecalculate = (accountRows || []).map((account) => account.id);

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

    await recalculateOpenTradeMarginsForLeverage(accountIdsToRecalculate, leverageNum);

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
    const closingMode = toBoolean(req.body?.closingMode ?? req.body?.closing_mode, false);

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

exports.updateLiquidationMode = async (req, res) => {
  try {
    const { id } = req.params;
    const mode = req.body?.liquidationType === 'illiquidate' ? 'illiquidate' : 'liquidate';

    const { error } = await supabase
      .from('users')
      .update({ liquidation_type: mode })
      .eq('id', id);

    if (error) throw error;

    res.json({ success: true, message: `Liquidation mode set to ${mode}` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.addBalanceToAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const { accountId, accountType = 'live' } = req.body;
    const amount = Number(req.body.amount);
    const note = firstNonEmptyString(req.body.note, req.body.remarks, 'Adjustment');
    const remarkKey = String(note || '').trim().toLowerCase();
    const balanceRemarks = new Set(['register balance', 'deposit', 'withdraw']);
    const equityOnlyRemarks = new Set(['settlement', 'adjustment']);

    if (!Number.isFinite(amount) || amount === 0) {
      return res.status(400).json({ success: false, message: 'Invalid amount' });
    }

    if (!balanceRemarks.has(remarkKey) && !equityOnlyRemarks.has(remarkKey)) {
      return res.status(400).json({ success: false, message: 'Select a valid ledger remark' });
    }

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
    const currentCredit = parseFloat(account.credit || 0);
    const isBalanceChange = balanceRemarks.has(remarkKey);
    const effectiveAmount = remarkKey === 'withdraw' && amount > 0 ? -amount : amount;
    const isReduction = isBalanceChange && effectiveAmount < 0;
    const absAmount = Math.abs(effectiveAmount);

    // For reductions, validate sufficient balance
    if (isReduction && absAmount > currentBalance) {
      return res.status(400).json({
        success: false,
        message: `Cannot reduce ₹${absAmount}. Current balance is ₹${currentBalance.toFixed(2)}`,
      });
    }

    const newBalance = isBalanceChange ? currentBalance + effectiveAmount : currentBalance;
    const newCredit = isBalanceChange ? currentCredit : currentCredit + effectiveAmount;
    const processedAt = new Date().toISOString();
    const transactionType = effectiveAmount < 0 ? 'withdrawal' : (remarkKey === 'settlement' ? 'settlement' : 'deposit');
    const description = `[${note}] Admin ledger ${effectiveAmount >= 0 ? 'credit' : 'debit'} ${absAmount.toFixed(2)}`;

    const { error: updateError } = await supabase
      .from('accounts')
      .update({
        balance: newBalance,
        credit: newCredit,
        updated_at: processedAt,
      })
      .eq('id', account.id);

    if (updateError) throw updateError;
    const snapshot = await recalculateAccountSnapshot(account.id, processedAt);

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
      message: isBalanceChange
        ? `Balance updated. New balance: ${newBalance.toFixed(2)}`
        : `Equity adjustment updated. New equity: ${snapshot.equity.toFixed(2)}`,
      newBalance,
      data: snapshot,
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

    const deleteRows = async (table, column, value, { optional = false } = {}) => {
      const { error } = await supabase.from(table).delete().eq(column, value);
      if (!error) return;

      const missingRelation = /relation .* does not exist|could not find the table|schema cache/i.test(error.message || '');
      if (optional && missingRelation) return;
      throw new Error(`${table}: ${error.message}`);
    };

    const { data: accountRows, error: accountLookupError } = await supabase
      .from('accounts')
      .select('id')
      .eq('user_id', id);
    if (accountLookupError) throw accountLookupError;
    const accountIds = (accountRows || []).map((account) => account.id).filter(Boolean);

    const { data: watchlistRows, error: watchlistLookupError } = await supabase
      .from('watchlists')
      .select('id')
      .eq('user_id', id);
    if (watchlistLookupError && !/relation .* does not exist|schema cache/i.test(watchlistLookupError.message || '')) {
      throw watchlistLookupError;
    }
    const watchlistIds = (watchlistRows || []).map((watchlist) => watchlist.id).filter(Boolean);

    // Settlement rows reference both users/accounts and trades. Remove them before
    // deleting either side of those foreign keys.
    await deleteRows('weekly_settlements', 'user_id', id, { optional: true });

    for (const accountId of accountIds) {
      await deleteRows('settlement_positions', 'account_id', accountId, { optional: true });
      await deleteRows('position_settlements', 'account_id', accountId, { optional: true });
    }
    await deleteRows('settlements', 'user_id', id, { optional: true });

    for (const watchlistId of watchlistIds) {
      await deleteRows('watchlist_symbols', 'watchlist_id', watchlistId, { optional: true });
    }

    await deleteRows('support_messages', 'user_id', id, { optional: true });
    await deleteRows('support_messages', 'sender_id', id, { optional: true });
    await deleteRows('watchlists', 'user_id', id, { optional: true });
    await deleteRows('pending_orders', 'user_id', id, { optional: true });

    const { error: processedByError } = await supabase
      .from('transactions')
      .update({ processed_by: null })
      .eq('processed_by', id);
    if (processedByError && !/processed_by|schema cache|column/i.test(processedByError.message || '')) {
      throw processedByError;
    }
    await deleteRows('transactions', 'user_id', id, { optional: true });
    await deleteRows('trades', 'user_id', id);
    await deleteRows('accounts', 'user_id', id);

    const { error: createdByError } = await supabase
      .from('users')
      .update({ created_by: null })
      .eq('created_by', id);
    if (createdByError && !/created_by|schema cache|column/i.test(createdByError.message || '')) {
      throw createdByError;
    }

    // Delete user
    const { error: deleteError } = await supabase
      .from('users')
      .delete()
      .eq('id', id);

    if (deleteError) throw deleteError;

    res.json({ 
      success: true, 
      message: `User ${user.login_id || user.email} deleted successfully` 
    });
  } catch (error) {
    console.error('deleteUser error:', error);
    res.status(500).json({
      success: false,
      message: `Failed to delete user safely: ${error.message}`,
    });
  }
};

// ============ WITHDRAWAL FUNCTIONS ============

exports.listWithdrawals = async (req, res) => {
  try {
    const { status } = req.query;

    const query = applyTransactionStatusFilter(
      supabase
        .from('transactions')
        .select(`
          *,
          users:user_id (email, first_name, last_name, login_id),
          accounts:account_id (account_number, is_demo)
        `)
        .or('type.eq.withdrawal,transaction_type.eq.withdrawal')
        .order('created_at', { ascending: false }),
      status,
    );

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

    const txnType = String(txn.type || txn.transaction_type || '').toLowerCase();
    if (!['withdraw', 'withdrawal'].includes(txnType)) {
      return res.status(400).json({ success: false, message: 'Transaction is not a withdrawal request' });
    }

    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select('*')
      .eq('id', txn.account_id)
      .single();

    if (accountError || !account) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    const amount = Number(txn.amount || 0);
    const currentBalance = Number(account.balance || 0);
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid withdrawal amount' });
    }
    const alreadyDebited = txn.balance_after !== null
      && txn.balance_after !== undefined
      && Number(txn.balance_after) < Number(txn.balance_before ?? txn.balance_after);
    if (!alreadyDebited && amount > currentBalance) {
      return res.status(400).json({
        success: false,
        message: `Insufficient balance. Available: INR ${currentBalance.toFixed(2)}`,
      });
    }

    const processedAt = new Date().toISOString();
    const balanceBefore = alreadyDebited ? Number(txn.balance_before ?? currentBalance + amount) : currentBalance;
    const newBalance = alreadyDebited ? currentBalance : currentBalance - amount;

    if (!alreadyDebited) {
      const { error: accountUpdateError } = await supabase
        .from('accounts')
        .update({
          balance: newBalance,
          updated_at: processedAt,
        })
        .eq('id', txn.account_id);

      if (accountUpdateError) throw accountUpdateError;
    }

    await recalculateAccountSnapshot(txn.account_id, processedAt);

    const { error: updateError } = await supabase
      .from('transactions')
      .update({
        status: 'completed',
        admin_note: adminNote || 'Approved by admin',
        balance_before: balanceBefore,
        balance_after: newBalance,
        processed_at: processedAt,
      })
      .eq('id', id);

    if (updateError) throw updateError;
    const snapshot = await recalculateAccountSnapshot(txn.account_id, processedAt);

    res.json({
      success: true,
      message: `Withdrawal approved. New balance: INR ${newBalance.toFixed(2)}`,
      newBalance,
      data: snapshot,
    });
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

    const wasPreviouslyHeld = txn.balance_after !== null
      && txn.balance_after !== undefined
      && Number(txn.balance_after) < Number(txn.balance_before ?? txn.balance_after);
    let balanceAfter = txn.balance_after;

    if (wasPreviouslyHeld) {
      const { data: account } = await supabase
        .from('accounts')
        .select('*')
        .eq('id', txn.account_id)
        .single();

      if (account) {
        balanceAfter = Number(account.balance || 0) + Number(txn.amount || 0);
        await supabase
          .from('accounts')
          .update({
            balance: balanceAfter,
            updated_at: new Date().toISOString(),
          })
          .eq('id', txn.account_id);
        await recalculateAccountSnapshot(txn.account_id);
      }
    }

    await updateTransactionAsRejected(id, {
      admin_note: adminNote || 'Rejected by admin',
      balance_after: balanceAfter,
    });

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
      .filter((txn) => matchesTransactionStatus(txn.status, status))
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

    await updateTransactionAsRejected(id, {
      admin_note: adminNote || 'QR deposit rejected by admin',
    });

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

const getKiteAuthSettingsValue = async () => {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', KITE_AUTH_SETTINGS_KEY)
    .maybeSingle();

  if (error) throw error;
  return normalizeKiteAuthSettings(parseAppSettingValue(data?.value));
};

const saveKiteAuthSettingsValue = async (value) => {
  const settings = normalizeKiteAuthSettings(value);
  const { error } = await supabase
    .from('app_settings')
    .upsert({
      key: KITE_AUTH_SETTINGS_KEY,
      value: JSON.stringify(settings),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
  if (error) throw error;
  return settings;
};

exports.getKiteAuthSettings = async (req, res) => {
  try {
    const settings = await getKiteAuthSettingsValue();
    res.json({ success: true, data: sanitizeKiteAuthSettings(settings) });
  } catch (error) {
    console.error('getKiteAuthSettings error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateKiteAuthSettings = async (req, res) => {
  try {
    const existingSettings = await getKiteAuthSettingsValue().catch(() => DEFAULT_KITE_AUTH_SETTINGS);
    const tokenMode = req.body?.tokenMode === 'manual' || req.body?.automatic === false
      ? 'manual'
      : 'automatic';
    const incomingProviders = req.body?.providers && typeof req.body.providers === 'object'
      ? req.body.providers
      : {};
    const settings = normalizeKiteAuthSettings({
      ...existingSettings,
      ...req.body,
      tokenMode,
      providers: {
        ...existingSettings.providers,
        ...incomingProviders,
        truedata: {
          ...existingSettings.providers?.truedata,
          ...incomingProviders.truedata,
          token: incomingProviders.truedata?.token || existingSettings.providers?.truedata?.token || '',
        },
        angelone: {
          ...existingSettings.providers?.angelone,
          ...incomingProviders.angelone,
          jwtToken: incomingProviders.angelone?.jwtToken || existingSettings.providers?.angelone?.jwtToken || '',
          feedToken: incomingProviders.angelone?.feedToken || existingSettings.providers?.angelone?.feedToken || '',
        },
      },
    });

    const { error } = await supabase
      .from('app_settings')
      .upsert({
        key: KITE_AUTH_SETTINGS_KEY,
        value: JSON.stringify(settings),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });

    if (error) throw error;

    res.json({ success: true, data: sanitizeKiteAuthSettings(settings), message: `Kite token mode set to ${tokenMode}` });
  } catch (error) {
    console.error('updateKiteAuthSettings error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

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

    // generateSession already saves and verifies the token. Avoid a duplicate DB write here.
    console.log('💾 Token saved by Kite service');

    // ── AUTO-SYNC instruments before stream start ──────────────────
    // This ensures the stream subscribes to the current valid contracts immediately.
    const kiteAuthSettings = await getKiteAuthSettingsValue().catch(() => DEFAULT_KITE_AUTH_SETTINGS);
    const automaticTokenMode = kiteAuthSettings.tokenMode !== 'manual';
    let syncResult = null;
    if (automaticTokenMode) try {
      const { syncKiteInstruments } = require('../utils/syncKiteInstruments');
      syncResult = await syncKiteInstruments();
      if (syncResult.success) {
        console.log(`📊 Auto-sync complete. Upserted ${syncResult.upserted || 0} instruments`);
      }
    } catch (syncErr) {
      console.warn('⚠️ Auto-sync failed:', syncErr.message);
    }

    // ── AUTO-RESTART STREAM with new token ──────────────────────────
    let streamResult = null;
    if (automaticTokenMode) try {
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

    let closingPriceRepair = [];
    try {
      closingPriceRepair = await closePriceSnapshotService.captureClosedSegmentsNow();
      const repairedQuotes = closingPriceRepair.flatMap((item) => item?.quotes || []);
      const io = req.app.get('io');
      if (io && repairedQuotes.length > 0) {
        io.emit('prices:snapshot', repairedQuotes);
      }

      if (closingPriceRepair.some((item) => item?.success)) {
        const socketHandler = req.app.get('socketHandler');
        await socketHandler?.refreshClosedPrices?.();
      }
    } catch (snapshotErr) {
      console.warn('Closing price repair after Kite login failed:', snapshotErr.message);
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
      message: automaticTokenMode
        ? 'Kite session created successfully! Stream restarted. Token valid until tomorrow 6 AM IST.'
        : 'Kite session created successfully! Manual mode is enabled, start stream when ready.',
      userId: session.userId,
      createdAt: session.createdAt,
      stream: streamResult,
      sync: syncResult,
      closingPriceRepair,
      holidays: holidayResult,
      authSettings: kiteAuthSettings,
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

    await angelOneStreamService.stop();
    const result = await kiteStreamService.start(io);

    if (result.started) {
      const existingSettings = await getKiteAuthSettingsValue().catch(() => DEFAULT_KITE_AUTH_SETTINGS);
      await saveKiteAuthSettingsValue({ ...existingSettings, activeProvider: 'kite' });
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
    if (angelOneStreamService.status().running) {
      return res.status(409).json({
        success: false,
        message: 'Angel One is active. Use Stop Angel before stopping the shared price stream.',
      });
    }
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
    const authSettings = await getKiteAuthSettingsValue().catch(() => DEFAULT_KITE_AUTH_SETTINGS);

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
      angelOneStream: angelOneStreamService.status(),
      authSettings: sanitizeKiteAuthSettings(authSettings),
    });
  } catch (error) {
    console.error('kiteStatus error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.setAngelOneSession = async (req, res) => {
  try {
    const existingSettings = await getKiteAuthSettingsValue().catch(() => DEFAULT_KITE_AUTH_SETTINGS);
    const existingAngel = existingSettings.providers?.angelone || {};
    const parsed = angelOneStreamService.parseSessionBundle(
      req.body?.sessionToken || req.body?.sessionBundle || req.body,
    );
    const apiKey = String(req.body?.apiKey || existingAngel.apiKey || '').trim();
    const clientCode = String(req.body?.clientCode || existingAngel.clientCode || '').trim();
    const jwtToken = parsed.jwtToken || String(req.body?.jwtToken || '').trim();
    const feedToken = parsed.feedToken || String(req.body?.feedToken || '').trim();

    if (!jwtToken || !feedToken) {
      return res.status(400).json({
        success: false,
        message: 'Paste the complete Angel redirect URL, JSON token bundle, or jwtToken|feedToken value.',
      });
    }
    if (!apiKey || !clientCode) {
      return res.status(400).json({
        success: false,
        message: 'Save the Angel One API key and client code first.',
      });
    }

    const io = req.app.get('io');
    if (!io) throw new Error('Socket.IO not available');
    const result = await angelOneStreamService.start({ io, apiKey, clientCode, jwtToken, feedToken });

    const settings = await saveKiteAuthSettingsValue({
      ...existingSettings,
      activeProvider: 'angelone',
      providers: {
        ...existingSettings.providers,
        angelone: {
          ...existingAngel,
          enabled: true,
          apiKey,
          clientCode,
          jwtToken,
          feedToken,
        },
      },
    });

    res.json({
      success: true,
      message: `Angel One stream started with ${result.tokens} exact-expiry instruments`,
      data: { ...result, activeProvider: settings.activeProvider },
    });
  } catch (error) {
    console.error('setAngelOneSession error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAngelOneLoginUrl = async (req, res) => {
  try {
    const settings = await getKiteAuthSettingsValue();
    const angel = settings.providers?.angelone || {};
    if (!angel.apiKey) {
      return res.status(400).json({ success: false, message: 'Save the Angel One API key first.' });
    }
    const redirectUrl = String(angel.redirectUrl || process.env.ANGEL_ONE_REDIRECT_URL || 'https://dashboard.tradeaxis.in').trim();
    const loginUrl = new URL('https://smartapi.angelone.in/publisher-login');
    loginUrl.searchParams.set('api_key', angel.apiKey);
    loginUrl.searchParams.set('redirect_url', redirectUrl);
    loginUrl.searchParams.set('state', `trade-axis-${Date.now()}`);
    res.json({
      success: true,
      loginUrl: loginUrl.toString(),
      redirectUrl,
      message: 'Complete Angel One login, then paste the complete redirected URL into Angel Session.',
    });
  } catch (error) {
    console.error('getAngelOneLoginUrl error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.startAngelOneStream = async (req, res) => {
  try {
    const settings = await getKiteAuthSettingsValue();
    const angel = settings.providers?.angelone || {};
    const io = req.app.get('io');
    if (!io) throw new Error('Socket.IO not available');
    const result = await angelOneStreamService.start({ io, ...angel });
    await saveKiteAuthSettingsValue({ ...settings, activeProvider: 'angelone' });
    res.json({ success: true, message: 'Angel One stream started', data: result });
  } catch (error) {
    console.error('startAngelOneStream error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.stopAngelOneStream = async (req, res) => {
  try {
    const result = await angelOneStreamService.stop();
    const settings = await getKiteAuthSettingsValue().catch(() => DEFAULT_KITE_AUTH_SETTINGS);
    await saveKiteAuthSettingsValue({ ...settings, activeProvider: 'kite' });
    res.json({ success: true, message: 'Angel One stream stopped', data: result });
  } catch (error) {
    console.error('stopAngelOneStream error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============ MARKET HOLIDAY TOGGLE ============
exports.setMarketHoliday = async (req, res) => {
  try {
    const { isHoliday, message, date, segments } = req.body;
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

    marketStatus.setHoliday(!!isHoliday, message || '', date || null, segments || {});

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
    const { tradeId, closePrice: manualPrice, reason, closeQuantity, applyBrokerage = true } = req.body;

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

    const requestedCloseQuantity = Number(closeQuantity || trade.quantity || 0);
    const totalTradeQuantity = Number(trade.quantity || 0);

    if (!Number.isFinite(requestedCloseQuantity) || requestedCloseQuantity <= 0) {
      return res.status(400).json({ success: false, message: 'Close quantity must be greater than 0' });
    }
    if (requestedCloseQuantity > totalTradeQuantity) {
      return res.status(400).json({ success: false, message: 'Close quantity cannot exceed open quantity' });
    }

    const preview = await tradingService.previewClosePosition(trade, {
      quantity: requestedCloseQuantity,
      closePrice: manualPrice && Number(manualPrice) > 0 ? Number(manualPrice) : undefined,
      applyBrokerage: applyBrokerage !== false,
    });

    if (!preview.success) {
      return res.status(400).json({
        success: false,
        message: preview.message || 'Cannot determine close price',
      });
    }

    const closeTime = new Date().toISOString();

    if (requestedCloseQuantity < totalTradeQuantity) {
      const remainingQuantity = totalTradeQuantity - requestedCloseQuantity;
      const remainingMargin = Math.max(0, Number(trade.margin || 0) - Number(preview.marginFreed || 0));
      const remainingBuyBrokerage = Math.max(0, Number(trade.buy_brokerage || trade.brokerage || 0) - Number(preview.buyBrokerage || 0));
      const direction = trade.trade_type === 'buy' ? 1 : -1;
      const currentPrice = Number(trade.current_price || trade.open_price || 0);
      const remainingProfit = ((currentPrice - Number(trade.open_price || 0)) * direction * remainingQuantity * Number(preview.lotSize || trade.lot_size || 1)) - remainingBuyBrokerage;

      const { data: closedTrade, error: closedError } = await supabase
        .from('trades')
        .insert({
          user_id: trade.user_id,
          account_id: trade.account_id,
          symbol: trade.symbol,
          exchange: trade.exchange,
          trade_type: trade.trade_type,
          quantity: requestedCloseQuantity,
          lot_size: preview.lotSize || trade.lot_size || 1,
          open_price: trade.open_price,
          close_price: preview.closePrice,
          current_price: preview.closePrice,
          stop_loss: trade.stop_loss || 0,
          take_profit: trade.take_profit || 0,
          margin: preview.marginFreed,
          buy_brokerage: preview.buyBrokerage,
          sell_brokerage: preview.sellBrokerage,
          brokerage: preview.totalBrokerage,
          profit: preview.netProfit,
          status: 'closed',
          open_time: trade.open_time,
          close_time: closeTime,
          updated_at: closeTime,
          comment: buildAdminTradeComment('Admin partial close', reason || 'Partial close by admin'),
        })
        .select()
        .single();

      if (closedError) throw closedError;

      const { error: updateRemainingError } = await supabase
        .from('trades')
        .update({
          quantity: remainingQuantity,
          margin: remainingMargin,
          buy_brokerage: remainingBuyBrokerage,
          brokerage: remainingBuyBrokerage,
          profit: remainingProfit,
          updated_at: closeTime,
        })
        .eq('id', tradeId);

      if (updateRemainingError) throw updateRemainingError;

      await tradingService.settleAccount(
        trade.account_id,
        preview.netProfit,
        preview.marginFreed,
        closeTime,
      );

      return res.json({
        success: true,
        data: closedTrade,
        message: `Admin closed ${requestedCloseQuantity} of ${trade.symbol} @ Rs.${preview.closePrice.toFixed(2)}. Remaining: ${remainingQuantity}`,
      });
    }

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
      openTime,
      closeTime,
      applyBrokerage = true,
    } = req.body || {};

    if (!tradeId) {
      return res.status(400).json({ success: false, message: 'Trade ID is required' });
    }

    const { data: trade, error: tradeError } = await supabase
      .from('trades')
      .select('*, accounts!inner(user_id, leverage)')
      .eq('id', tradeId)
      .single();

    if (tradeError || !trade) {
      return res.status(404).json({ success: false, message: 'Trade not found' });
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
    const shouldApplyBrokerage = applyBrokerage !== false;
    const brokerageRate = shouldApplyBrokerage ? await tradingService.getBrokerageRate(trade.user_id) : 0;
    const nextMargin = (nextOpenPrice * nextQuantity * lotSize) / leverage;
    const nextBuyBrokerage = shouldApplyBrokerage ? nextOpenPrice * nextQuantity * lotSize * brokerageRate : 0;
    const direction = trade.trade_type === 'buy' ? 1 : -1;
    const nextProfit = ((nextCurrentPrice - nextOpenPrice) * direction * nextQuantity * lotSize) - nextBuyBrokerage;
    const updatedAt = new Date().toISOString();

    const updates = {
      quantity: nextQuantity,
      open_price: nextOpenPrice,
      margin: nextMargin,
      buy_brokerage: nextBuyBrokerage,
      brokerage: nextBuyBrokerage,
      profit: nextProfit,
      updated_at: updatedAt,
    };

    if (trade.status === 'closed') {
      updates.close_price = nextCurrentPrice;
      updates.current_price = nextCurrentPrice;
    } else {
      updates.current_price = nextCurrentPrice;
    }

    if (stopLoss !== undefined) updates.stop_loss = Number(stopLoss) || 0;
    if (takeProfit !== undefined) updates.take_profit = Number(takeProfit) || 0;
    if (comment !== undefined) updates.comment = fitTradeComment(comment);
    if (openTime !== undefined) {
      const parsedOpen = openTime ? new Date(openTime) : null;
      if (parsedOpen && !Number.isNaN(parsedOpen.getTime())) updates.open_time = parsedOpen.toISOString();
    }
    if (closeTime !== undefined) {
      const parsedClose = closeTime ? new Date(closeTime) : null;
      if (parsedClose && !Number.isNaN(parsedClose.getTime())) updates.close_time = parsedClose.toISOString();
    }

    const { data: updatedTrade, error: updateError } = await supabase
      .from('trades')
      .update(updates)
      .eq('id', tradeId)
      .select()
      .single();

    if (updateError) throw updateError;

    if (trade.status === 'closed') {
      const profitDelta = Number(updatedTrade.profit || 0) - Number(trade.profit || 0);
      if (profitDelta) {
        const { data: account, error: accountError } = await supabase
          .from('accounts')
          .select('credit')
          .eq('id', trade.account_id)
          .single();
        if (accountError || !account) throw accountError || new Error('Account not found');
        const { error: creditError } = await supabase
          .from('accounts')
          .update({
            credit: Number(account.credit || 0) + profitDelta,
            updated_at: updatedAt,
          })
          .eq('id', trade.account_id);
        if (creditError) throw creditError;
      }
    }

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
      .select('id, symbol, account_id, profit, status')
      .eq('id', tradeId)
      .single();

    if (tradeError || !trade) {
      return res.status(404).json({ success: false, message: 'Trade not found' });
    }

    if (trade.status === 'closed' && Number(trade.profit || 0)) {
      const { data: account, error: accountError } = await supabase
        .from('accounts')
        .select('credit')
        .eq('id', trade.account_id)
        .single();
      if (accountError || !account) throw accountError || new Error('Account not found');
      const { error: creditError } = await supabase
        .from('accounts')
        .update({ credit: Number(account.credit || 0) - Number(trade.profit || 0) })
        .eq('id', trade.account_id);
      if (creditError) throw creditError;
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
      .in('status', ['completed', ...REJECTED_TRANSACTION_STATUSES])
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
