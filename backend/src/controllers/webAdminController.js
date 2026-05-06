const bcrypt = require('bcryptjs');
const { supabase } = require('../config/supabase');
const { generateAccountNumber } = require('../utils/auth');
const { fitTradeComment } = require('../utils/tradeCommentEvents');
const kiteStreamService = require('../services/kiteStreamService');
const {
  getAllowedLeverageOptions,
  isAllowedLeverage,
} = require('../config/leverageOptions');

const isAdmin = (req) => String(req.user?.role || '').toLowerCase() === 'admin';
const isSubBroker = (req) => String(req.user?.role || '').toLowerCase() === 'sub_broker';

const calculateLiveTradeValues = (row) => {
  if (!row || row.status !== 'open') return row;

  const cached = kiteStreamService.getPrice(row.symbol);
  const livePrice = Number(cached?.last || cached?.ltp || cached?.price || 0);
  const currentPrice = livePrice > 0
    ? livePrice
    : Number(row.current_price || row.close_price || row.open_price || 0);
  const quantity = Number(row.quantity || 0);
  const openPrice = Number(row.open_price || 0);
  const lotSize = Number(row.lot_size || 1) || 1;
  const direction = row.trade_type === 'sell' ? -1 : 1;
  const buyBrokerage = Number(row.buy_brokerage ?? row.brokerage ?? 0);
  const profit = openPrice && currentPrice && quantity
    ? ((currentPrice - openPrice) * direction * quantity * lotSize) - buyBrokerage
    : Number(row.profit || 0);

  return {
    ...row,
    current_price: currentPrice,
    profit,
  };
};

const recalculateAccountSnapshot = async (accountId, updatedAt = new Date().toISOString()) => {
  const { data: account, error: accountError } = await supabase
    .from('accounts')
    .select('balance, credit')
    .eq('id', accountId)
    .single();

  if (accountError || !account) throw accountError || new Error('Account not found');

  const { data: openTrades, error: openTradesError } = await supabase
    .from('trades')
    .select('profit, margin')
    .eq('account_id', accountId)
    .eq('status', 'open');

  if (openTradesError) throw openTradesError;

  const floatingProfit = (openTrades || []).reduce((sum, row) => sum + Number(row.profit || 0), 0);
  const totalMargin = (openTrades || []).reduce((sum, row) => sum + Number(row.margin || 0), 0);
  const balance = Number(account.balance || 0);
  const credit = Number(account.credit || 0);
  const equity = balance + credit + floatingProfit;
  const freeMargin = equity - totalMargin;

  const { error: updateError } = await supabase
    .from('accounts')
    .update({ equity, margin: totalMargin, free_margin: freeMargin, updated_at: updatedAt })
    .eq('id', accountId);

  if (updateError) throw updateError;
};

const normalizeRole = (role) => {
  const value = String(role || 'user').toLowerCase().trim();
  if (value === 'subbroker' || value === 'sub-broker') return 'sub_broker';
  if (['admin', 'sub_broker', 'user'].includes(value)) return value;
  return 'user';
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getManagedUserIds = async (req) => {
  if (isAdmin(req)) return null;

  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('created_by', req.user.id);

  if (error) throw error;
  return (data || []).map((user) => user.id);
};

const assertManagedUser = async (req, userId) => {
  if (!userId) {
    const err = new Error('User is required');
    err.status = 400;
    throw err;
  }

  if (isAdmin(req)) return true;

  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('id', userId)
    .eq('created_by', req.user.id)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    const err = new Error('User is outside your client book');
    err.status = 403;
    throw err;
  }

  return true;
};

const getScopedTransactionQuery = async (req, type) => {
  let query = supabase
    .from('transactions')
    .select(`
      *,
      users:user_id (email, first_name, last_name, login_id, created_by),
      accounts:account_id (account_number, is_demo)
    `)
    .or(`type.eq.${type},transaction_type.eq.${type}`)
    .order('created_at', { ascending: false })
    .limit(500);

  const userIds = await getManagedUserIds(req);
  if (Array.isArray(userIds)) {
    if (userIds.length === 0) return { empty: true };
    query = query.in('user_id', userIds);
  }

  return { query };
};

const mapTransaction = (txn) => ({
  ...txn,
  user_email: txn.users?.email || '',
  user_name: txn.users
    ? `${txn.users.first_name || ''} ${txn.users.last_name || ''}`.trim()
    : '',
  user_login_id: txn.users?.login_id || '',
  account_number: txn.accounts?.account_number || '',
  is_demo: txn.accounts?.is_demo || false,
});

const attachUserAndAccountInfo = async (rows = []) => {
  const userIds = [...new Set(rows.map((row) => row.user_id).filter(Boolean))];
  const accountIds = [...new Set(rows.map((row) => row.account_id).filter(Boolean))];
  const userMap = new Map();
  const accountMap = new Map();

  if (userIds.length) {
    const { data: users, error } = await supabase
      .from('users')
      .select('id, login_id, email, first_name, last_name, role, created_by')
      .in('id', userIds);
    if (error) throw error;
    (users || []).forEach((user) => userMap.set(user.id, user));
  }

  if (accountIds.length) {
    const { data: accounts, error } = await supabase
      .from('accounts')
      .select('id, account_number, is_demo, balance, equity, margin, free_margin, leverage')
      .in('id', accountIds);
    if (error) throw error;
    (accounts || []).forEach((account) => accountMap.set(account.id, account));
  }

  return rows.map((row) => {
    const user = userMap.get(row.user_id) || {};
    const account = accountMap.get(row.account_id) || {};
    return {
      ...row,
      user_login_id: user.login_id || '',
      user_name: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
      user_email: user.email || '',
      account_number: account.account_number || '',
      is_demo: account.is_demo || false,
      account_balance: account.balance,
      account_equity: account.equity,
      account_margin: account.margin,
      account_free_margin: account.free_margin,
      account_leverage: account.leverage,
    };
  });
};

exports.summary = async (req, res) => {
  try {
    const userIds = await getManagedUserIds(req);
    const scoped = Array.isArray(userIds);

    const userQuery = supabase.from('users').select('id, role, is_active');
    const accountQuery = supabase.from('accounts').select('id, user_id, balance, equity, margin, free_margin');
    const openTradeQuery = supabase.from('trades').select('id, user_id, profit, margin').eq('status', 'open');
    const txnQuery = supabase.from('transactions').select('id, user_id, amount, status, type, transaction_type');

    if (scoped) {
      if (userIds.length === 0) {
        return res.json({
          success: true,
          data: {
            users: 0,
            subBrokers: 0,
            activeUsers: 0,
            equity: 0,
            margin: 0,
            openTrades: 0,
            openPnL: 0,
            pendingWithdrawals: 0,
            pendingDeposits: 0,
          },
        });
      }
      userQuery.in('id', userIds);
      accountQuery.in('user_id', userIds);
      openTradeQuery.in('user_id', userIds);
      txnQuery.in('user_id', userIds);
    }

    const [usersRes, accountsRes, tradesRes, txnsRes] = await Promise.all([
      userQuery,
      accountQuery,
      openTradeQuery,
      txnQuery,
    ]);

    if (usersRes.error) throw usersRes.error;
    if (accountsRes.error) throw accountsRes.error;
    if (tradesRes.error) throw tradesRes.error;
    if (txnsRes.error) throw txnsRes.error;

    const users = usersRes.data || [];
    const accounts = accountsRes.data || [];
    const trades = tradesRes.data || [];
    const txns = txnsRes.data || [];

    res.json({
      success: true,
      data: {
        users: users.filter((u) => u.role !== 'admin' && u.role !== 'sub_broker').length,
        subBrokers: users.filter((u) => u.role === 'sub_broker').length,
        activeUsers: users.filter((u) => u.is_active !== false).length,
        equity: accounts.reduce((sum, row) => sum + toNumber(row.equity), 0),
        margin: accounts.reduce((sum, row) => sum + toNumber(row.margin), 0),
        freeMargin: accounts.reduce((sum, row) => sum + toNumber(row.free_margin), 0),
        openTrades: trades.length,
        openPnL: trades.reduce((sum, row) => sum + toNumber(row.profit), 0),
        pendingWithdrawals: txns.filter((txn) =>
          String(txn.status).toLowerCase() === 'pending' &&
          [txn.type, txn.transaction_type].includes('withdrawal')
        ).length,
        pendingDeposits: txns.filter((txn) =>
          String(txn.status).toLowerCase() === 'pending' &&
          [txn.type, txn.transaction_type].includes('deposit')
        ).length,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.listUsers = async (req, res) => {
  try {
    const { q = '', role = 'all', limit = 500 } = req.query;
    let query = supabase
      .from('users')
      .select(`
        id, login_id, email, first_name, last_name, phone, role, is_active,
        leverage, brokerage_rate, max_saved_accounts, closing_mode,
        liquidation_type, created_by, created_at
      `)
      .order('created_at', { ascending: false })
      .limit(Number(limit) || 500);

    if (isSubBroker(req)) query = query.eq('created_by', req.user.id);
    if (role && role !== 'all') query = query.eq('role', normalizeRole(role));
    if (q && q.trim()) {
      const term = q.trim().toLowerCase();
      query = query.or(`email.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%,login_id.ilike.%${term}%`);
    }

    const { data: users, error } = await query;
    if (error) throw error;

    const userIds = (users || []).map((u) => u.id);
    let accountsByUserId = new Map();

    if (userIds.length) {
      const { data: accounts, error: accountsError } = await supabase
        .from('accounts')
        .select('id, user_id, account_number, is_demo, balance, credit, equity, margin, free_margin, leverage')
        .in('user_id', userIds);

      if (accountsError) throw accountsError;
      accountsByUserId = (accounts || []).reduce((map, account) => {
        if (!map.has(account.user_id)) map.set(account.user_id, []);
        map.get(account.user_id).push(account);
        return map;
      }, new Map());
    }

    res.json({
      success: true,
      data: (users || []).map((user) => ({
        ...user,
        accounts: accountsByUserId.get(user.id) || [],
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createUser = async (req, res) => {
  try {
    const {
      loginId,
      password = 'TA1234',
      firstName = '',
      lastName = '',
      phone = '',
      email = '',
      role = 'user',
      leverage = 30,
      brokerageRate = 0.0006,
      maxSavedAccounts = 10,
      demoBalance = 100000,
      createDemo = true,
      createLive = true,
      liquidationType = 'liquidate',
      createdBy = null,
    } = req.body || {};

    const cleanLoginId = String(loginId || '').trim().toUpperCase();
    if (!cleanLoginId) {
      return res.status(400).json({ success: false, message: 'Login ID is required' });
    }

    const targetRole = isSubBroker(req) ? 'user' : normalizeRole(role);
    if (targetRole === 'admin' && !isAdmin(req)) {
      return res.status(403).json({ success: false, message: 'Only admin can create admin users' });
    }

    const leverageNum = Number(leverage) || 30;
    if (!isAllowedLeverage(leverageNum)) {
      return res.status(400).json({
        success: false,
        message: `Unsupported leverage. Allowed: ${getAllowedLeverageOptions().join(', ')}`,
      });
    }

    if (!createDemo && !createLive) {
      return res.status(400).json({ success: false, message: 'Select at least one account type' });
    }

    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('login_id', cleanLoginId)
      .maybeSingle();

    if (existing) {
      return res.status(400).json({ success: false, message: 'Login ID already exists' });
    }

    const ownerId = isSubBroker(req) ? req.user.id : (createdBy || null);
    const userEmail = email ? String(email).toLowerCase().trim() : `${cleanLoginId.toLowerCase()}@tradeaxis.local`;
    const hashedPassword = await bcrypt.hash(String(password || 'TA1234'), 12);

    const { data: user, error } = await supabase
      .from('users')
      .insert([{
        user_id: cleanLoginId,
        login_id: cleanLoginId,
        email: userEmail,
        password_hash: hashedPassword,
        first_name: String(firstName || cleanLoginId).trim().substring(0, 50),
        last_name: String(lastName || '').trim().substring(0, 50),
        phone: String(phone || '').trim().substring(0, 15),
        role: targetRole,
        is_verified: false,
        is_active: true,
        created_by: ownerId,
        leverage: leverageNum,
        brokerage_rate: Number(brokerageRate) || 0.0006,
        max_saved_accounts: Number(maxSavedAccounts) || 10,
        closing_mode: false,
        must_change_password: true,
        liquidation_type: liquidationType || 'liquidate',
      }])
      .select()
      .single();

    if (error) throw error;

    const accountsToCreate = [];
    if (createDemo) {
      accountsToCreate.push({
        user_id: user.id,
        account_number: generateAccountNumber(true).substring(0, 20),
        account_type: 'demo',
        is_demo: true,
        balance: Number(demoBalance) || 100000,
        equity: Number(demoBalance) || 100000,
        margin: 0,
        free_margin: Number(demoBalance) || 100000,
        leverage: leverageNum,
        currency: 'INR',
        is_active: true,
      });
    }

    if (createLive) {
      accountsToCreate.push({
        user_id: user.id,
        account_number: generateAccountNumber(false).substring(0, 20),
        account_type: 'standard',
        is_demo: false,
        balance: 0,
        equity: 0,
        margin: 0,
        free_margin: 0,
        leverage: leverageNum,
        currency: 'INR',
        is_active: true,
      });
    }

    if (accountsToCreate.length) {
      const { error: accountsError } = await supabase.from('accounts').insert(accountsToCreate);
      if (accountsError) throw accountsError;
    }

    res.json({
      success: true,
      message: `${targetRole === 'sub_broker' ? 'Sub broker' : 'User'} created successfully`,
      data: { user, loginId: cleanLoginId, tempPassword: password || 'TA1234' },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.assignBroker = async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ success: false, message: 'Only admin can assign brokers' });
    }

    const { userId, brokerId } = req.body || {};
    if (!userId) return res.status(400).json({ success: false, message: 'User is required' });

    if (brokerId) {
      const { data: broker, error } = await supabase
        .from('users')
        .select('id, role')
        .eq('id', brokerId)
        .eq('role', 'sub_broker')
        .maybeSingle();
      if (error) throw error;
      if (!broker) return res.status(404).json({ success: false, message: 'Sub broker not found' });
    }

    const { error: updateError } = await supabase
      .from('users')
      .update({ created_by: brokerId || null })
      .eq('id', userId)
      .eq('role', 'user');

    if (updateError) throw updateError;
    res.json({ success: true, message: brokerId ? 'User assigned to sub broker' : 'Broker assignment removed' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.listTransactions = async (req, res) => {
  try {
    const { type = 'withdrawal', status = 'all' } = req.query;
    const normalizedType = type === 'deposit' ? 'deposit' : 'withdrawal';
    const scoped = await getScopedTransactionQuery(req, normalizedType);
    if (scoped.empty) return res.json({ success: true, data: [] });

    let { query } = scoped;
    if (status && status !== 'all') query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;

    res.json({ success: true, data: (data || []).map(mapTransaction) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const { action, adminNote = '' } = req.body || {};
    const nextStatus = action === 'approve' ? 'completed' : action === 'reject' ? 'rejected' : '';
    if (!nextStatus) {
      return res.status(400).json({ success: false, message: 'Action must be approve or reject' });
    }

    const { data: txn, error } = await supabase
      .from('transactions')
      .select('*, accounts:account_id (*), users:user_id (id, created_by)')
      .eq('id', id)
      .single();

    if (error || !txn) return res.status(404).json({ success: false, message: 'Transaction not found' });
    await assertManagedUser(req, txn.user_id);

    const type = String(txn.type || txn.transaction_type || '').toLowerCase();
    const amount = toNumber(txn.amount);
    const processedAt = new Date().toISOString();

    if (nextStatus === 'completed' && type === 'deposit') {
      const account = txn.accounts;
      const newBalance = toNumber(account.balance) + amount;
      await supabase
        .from('accounts')
        .update({
          balance: newBalance,
          equity: newBalance + toNumber(account.credit) + toNumber(account.profit),
          free_margin: newBalance + toNumber(account.credit) + toNumber(account.profit) - toNumber(account.margin),
          updated_at: processedAt,
        })
        .eq('id', txn.account_id);
    }

    let withdrawalBalanceBefore = null;
    let withdrawalBalanceAfter = null;

    if (nextStatus === 'completed' && ['withdraw', 'withdrawal'].includes(type)) {
      const account = txn.accounts;
      const currentBalance = toNumber(account.balance);
      const alreadyDebited = txn.balance_after !== null
        && txn.balance_after !== undefined
        && Number(txn.balance_after) < Number(txn.balance_before ?? txn.balance_after);
      withdrawalBalanceBefore = alreadyDebited ? Number(txn.balance_before ?? currentBalance + amount) : currentBalance;
      withdrawalBalanceAfter = alreadyDebited ? currentBalance : currentBalance - amount;
      if (!amount || amount <= 0) {
        return res.status(400).json({ success: false, message: 'Invalid withdrawal amount' });
      }
      if (!alreadyDebited && amount > currentBalance) {
        return res.status(400).json({
          success: false,
          message: `Insufficient balance. Available: INR ${currentBalance.toFixed(2)}`,
        });
      }
      if (!alreadyDebited) {
        await supabase
          .from('accounts')
          .update({
            balance: withdrawalBalanceAfter,
            updated_at: processedAt,
          })
          .eq('id', txn.account_id);
      }
      await recalculateAccountSnapshot(txn.account_id, processedAt);
    }

    let rejectedWithdrawalBalanceAfter = txn.balance_after;
    if (nextStatus === 'rejected' && ['withdraw', 'withdrawal'].includes(type)) {
      const wasPreviouslyHeld = txn.balance_after !== null
        && txn.balance_after !== undefined
        && Number(txn.balance_after) < Number(txn.balance_before ?? txn.balance_after);
      if (wasPreviouslyHeld) {
        const account = txn.accounts;
        const newBalance = toNumber(account.balance) + amount;
        rejectedWithdrawalBalanceAfter = newBalance;
        await supabase
          .from('accounts')
          .update({
            balance: newBalance,
            updated_at: processedAt,
          })
          .eq('id', txn.account_id);
        await recalculateAccountSnapshot(txn.account_id, processedAt);
      }
    }

    const accountBalanceBefore = toNumber(txn.accounts?.balance);
    const balanceAfter = nextStatus === 'completed' && ['withdraw', 'withdrawal'].includes(type)
      ? withdrawalBalanceAfter
      : nextStatus === 'completed' && type === 'deposit'
        ? accountBalanceBefore + amount
        : nextStatus === 'rejected' && ['withdraw', 'withdrawal'].includes(type)
          ? rejectedWithdrawalBalanceAfter
          : txn.balance_after;

    const { error: updateError } = await supabase
      .from('transactions')
      .update({
        status: nextStatus,
        admin_note: adminNote || `${nextStatus} from web console`,
        balance_before: action === 'approve'
          ? (withdrawalBalanceBefore ?? accountBalanceBefore)
          : txn.balance_before,
        balance_after: balanceAfter,
        processed_at: processedAt,
      })
      .eq('id', id);

    if (updateError) throw updateError;
    res.json({ success: true, message: `Transaction ${nextStatus}` });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

exports.openPositions = async (req, res) => {
  try {
    const { userId = '' } = req.query;
    if (userId) await assertManagedUser(req, userId);

    let query = supabase
      .from('trades')
      .select('id, symbol, exchange, trade_type, quantity, open_price, current_price, profit, margin, brokerage, user_id, account_id, open_time, stop_loss, take_profit, comment')
      .eq('status', 'open')
      .order('open_time', { ascending: false })
      .limit(500);

    if (userId) {
      query = query.eq('user_id', userId);
    } else {
      const userIds = await getManagedUserIds(req);
      if (Array.isArray(userIds)) {
        if (userIds.length === 0) return res.json({ success: true, data: [] });
        query = query.in('user_id', userIds);
      }
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

exports.positions = async (req, res) => {
  try {
    const {
      userId = '',
      status = 'open',
      q = '',
      limit = 1000,
    } = req.query;

    if (userId) await assertManagedUser(req, userId);

    let query = supabase
      .from('trades')
      .select('id, symbol, exchange, trade_type, quantity, lot_size, open_price, close_price, current_price, profit, margin, brokerage, buy_brokerage, sell_brokerage, user_id, account_id, open_time, close_time, stop_loss, take_profit, comment, status, created_at, updated_at')
      .order(status === 'closed' ? 'close_time' : 'open_time', { ascending: false })
      .limit(Math.min(Number(limit) || 1000, 2000));

    if (status && status !== 'all') query = query.eq('status', status);
    if (userId) {
      query = query.eq('user_id', userId);
    } else {
      const userIds = await getManagedUserIds(req);
      if (Array.isArray(userIds)) {
        if (userIds.length === 0) return res.json({ success: true, data: [] });
        query = query.in('user_id', userIds);
      }
    }

    if (q && q.trim()) {
      const term = q.trim();
      query = query.or(`symbol.ilike.%${term}%,comment.ilike.%${term}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    const liveRows = (data || []).map(calculateLiveTradeValues);
    res.json({ success: true, data: await attachUserAndAccountInfo(liveRows) });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

exports.orders = async (req, res) => {
  try {
    const {
      userId = '',
      status = 'executed',
      q = '',
      limit = 1000,
    } = req.query;

    if (userId) await assertManagedUser(req, userId);

    const scopedUserIds = await getManagedUserIds(req);
    const applyScope = (query) => {
      let next = query;
      if (userId) next = next.eq('user_id', userId);
      else if (Array.isArray(scopedUserIds)) {
        if (scopedUserIds.length === 0) return null;
        next = next.in('user_id', scopedUserIds);
      }
      return next;
    };

    if (status === 'executed') {
      let query = supabase
        .from('trades')
        .select('id, user_id, account_id, symbol, trade_type, quantity, open_price, current_price, status, open_time, close_time, comment')
        .order('open_time', { ascending: false })
        .limit(Math.min(Number(limit) || 1000, 2000));
      query = applyScope(query);
      if (!query) return res.json({ success: true, data: [] });
      if (q && q.trim()) query = query.or(`symbol.ilike.%${q.trim()}%,comment.ilike.%${q.trim()}%`);
      const { data, error } = await query;
      if (error) throw error;
      const rows = await attachUserAndAccountInfo(data || []);
      return res.json({
        success: true,
        data: rows.map((row) => ({
          ...row,
          order_status: 'executed',
          order_type: 'market',
          rate: row.open_price,
          time: row.open_time,
        })),
      });
    }

    let query = supabase
      .from('pending_orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(Math.min(Number(limit) || 1000, 2000));

    if (status === 'pending') query = query.eq('status', 'pending');
    if (status === 'rejected') query = query.in('status', ['rejected', 'cancelled', 'failed']);
    query = applyScope(query);
    if (!query) return res.json({ success: true, data: [] });
    if (q && q.trim()) query = query.or(`symbol.ilike.%${q.trim()}%,comment.ilike.%${q.trim()}%`);

    const { data, error } = await query;
    if (error) {
      return res.json({ success: true, data: [] });
    }
    res.json({ success: true, data: await attachUserAndAccountInfo(data || []) });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

exports.closePosition = async (req, res, next) => {
  try {
    const { tradeId } = req.body || {};
    if (!tradeId) return res.status(400).json({ success: false, message: 'Trade ID is required' });

    const { data: trade, error } = await supabase
      .from('trades')
      .select('id, user_id')
      .eq('id', tradeId)
      .maybeSingle();

    if (error) throw error;
    if (!trade) return res.status(404).json({ success: false, message: 'Trade not found' });
    await assertManagedUser(req, trade.user_id);
    next();
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

exports.closeAllUserPositions = async (req, res, next) => {
  try {
    await assertManagedUser(req, req.body?.userId);
    next();
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

exports.positionWriteAccess = async (req, res, next) => {
  try {
    const { tradeId } = req.params;
    if (!tradeId) return res.status(400).json({ success: false, message: 'Trade ID is required' });

    const { data: trade, error } = await supabase
      .from('trades')
      .select('id, user_id')
      .eq('id', tradeId)
      .maybeSingle();

    if (error) throw error;
    if (!trade) return res.status(404).json({ success: false, message: 'Trade not found' });
    await assertManagedUser(req, trade.user_id);
    next();
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

exports.reopenPosition = async (req, res) => {
  try {
    const { tradeId } = req.params;
    if (!tradeId) return res.status(400).json({ success: false, message: 'Trade ID is required' });

    const { data: trade, error: tradeError } = await supabase
      .from('trades')
      .select('*')
      .eq('id', tradeId)
      .eq('status', 'closed')
      .single();

    if (tradeError || !trade) {
      return res.status(404).json({ success: false, message: 'Closed trade not found' });
    }

    await assertManagedUser(req, trade.user_id);

    const now = new Date().toISOString();
    const profitToReverse = Number(trade.profit || 0);
    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select('credit')
      .eq('id', trade.account_id)
      .single();
    if (accountError || !account) throw accountError || new Error('Account not found');

    const { error: creditError } = await supabase
      .from('accounts')
      .update({
        credit: Number(account.credit || 0) - profitToReverse,
        updated_at: now,
      })
      .eq('id', trade.account_id);
    if (creditError) throw creditError;

    const reopened = calculateLiveTradeValues({
      ...trade,
      close_price: null,
      close_time: null,
      sell_brokerage: 0,
      brokerage: Number(trade.buy_brokerage || trade.brokerage || 0),
      status: 'open',
      updated_at: now,
    });

    const { data: updatedTrade, error: updateError } = await supabase
      .from('trades')
      .update({
        close_price: null,
        close_time: null,
        sell_brokerage: 0,
        brokerage: Number(trade.buy_brokerage || trade.brokerage || 0),
        current_price: reopened.current_price,
        profit: reopened.profit,
        status: 'open',
        updated_at: now,
      })
      .eq('id', trade.id)
      .select()
      .single();

    if (updateError) throw updateError;
    await recalculateAccountSnapshot(trade.account_id, now);

    res.json({ success: true, data: updatedTrade, message: 'Position reopened successfully' });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

exports.tradeOnBehalf = async (req, res) => {
  try {
    const {
      userId,
      accountId,
      symbol,
      side,
      quantity,
      openPrice,
      currentPrice,
      stopLoss = 0,
      takeProfit = 0,
      entryTime,
      comment = '',
    } = req.body || {};

    await assertManagedUser(req, userId);

    const qty = Number(quantity);
    const price = Number(openPrice);
    if (!symbol || !side || !qty || qty <= 0 || !price || price <= 0) {
      return res.status(400).json({
        success: false,
        message: 'User, symbol, side, quantity and opening price are required',
      });
    }

    const { data: symbolData, error: symbolError } = await supabase
      .from('symbols')
      .select('*')
      .eq('symbol', String(symbol).toUpperCase())
      .single();

    if (symbolError || !symbolData) {
      return res.status(404).json({ success: false, message: 'Script not found' });
    }

    let accountQuery = supabase
      .from('accounts')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (accountId) {
      accountQuery = accountQuery.eq('id', accountId);
    } else {
      accountQuery = accountQuery.eq('is_demo', false).limit(1);
    }

    const { data: accountRows, error: accountError } = await accountQuery;
    const account = Array.isArray(accountRows) ? accountRows[0] : accountRows;
    if (accountError || !account) {
      return res.status(404).json({ success: false, message: 'Account not found for selected user' });
    }

    const tradeType = side === 'sell' ? 'sell' : 'buy';
    const lotSize = Number(symbolData.lot_size || 1) || 1;
    const leverage = Number(account.leverage || 5) || 5;
    const brokerageRate = await require('../services/tradingService').getBrokerageRate(userId);
    const marginRequired = (price * qty * lotSize) / leverage;
    const brokerage = price * qty * lotSize * brokerageRate;
    const requestedEntryTime = entryTime ? new Date(entryTime) : null;
    const now = requestedEntryTime && !Number.isNaN(requestedEntryTime.getTime())
      ? requestedEntryTime.toISOString()
      : new Date().toISOString();
    const accountEquity = Number(account.equity ?? (Number(account.balance || 0) + Number(account.credit || 0)));
    const newMargin = Number(account.margin || 0) + marginRequired;

    const tradeData = {
      user_id: userId,
      account_id: account.id,
      symbol: symbolData.symbol,
      exchange: symbolData.exchange || 'NSE',
      trade_type: tradeType,
      quantity: qty,
      open_price: price,
      current_price: Number(currentPrice || price),
      stop_loss: Number(stopLoss) || 0,
      take_profit: Number(takeProfit) || 0,
      margin: marginRequired,
      brokerage,
      buy_brokerage: brokerage,
      sell_brokerage: 0,
      profit: -brokerage,
      status: 'open',
      comment: fitTradeComment(comment || `Trade opened on behalf by ${req.user.email || req.user.id}`),
      open_time: now,
    };

    const { data: trade, error: tradeError } = await supabase
      .from('trades')
      .insert(tradeData)
      .select()
      .single();

    if (tradeError) throw tradeError;

    const { error: updateError } = await supabase
      .from('accounts')
      .update({
        margin: newMargin,
        free_margin: accountEquity - newMargin,
        updated_at: now,
      })
      .eq('id', account.id);

    if (updateError) throw updateError;

    res.json({
      success: true,
      data: trade,
      message: `${tradeType.toUpperCase()} ${symbolData.symbol} opened for selected user`,
    });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};
