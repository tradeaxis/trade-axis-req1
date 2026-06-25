const bcrypt = require('bcryptjs');
const { supabase } = require('../config/supabase');
const { generateAccountNumber } = require('../utils/auth');
const {
  buildTradeEntryEvent,
  ensureTradeEntryHistory,
  fitTradeComment,
  mergeTradeCommentEvents,
} = require('../utils/tradeCommentEvents');
const kiteStreamService = require('../services/kiteStreamService');
const { filterSupersededSettlementTrades } = require('../services/openTradeSnapshot');
const { isMarketOpen } = require('../services/marketStatus');
const { QUOTE_FRESHNESS_MS, getAgeMs } = require('../services/quoteGuard');
const {
  getAllowedLeverageOptions,
  isAllowedLeverage,
} = require('../config/leverageOptions');

const isAdmin = (req) => String(req.user?.role || '').toLowerCase() === 'admin';
const isSubBroker = (req) => String(req.user?.role || '').toLowerCase() === 'sub_broker';
const SUB_BROKER_PERMISSIONS_KEY = 'sub_broker_feature_permissions';
const SUB_BROKER_FEATURES = [
  'workspace',
  'adminPositions',
  'adminPositionsEdit',
  'adminPositionsExit',
  'adminPositionsDelete',
  'adminPositionsReopen',
  'adminOrders',
  'users',
  'usersCreate',
  'usersPositions',
  'usersLedger',
  'usersUpdate',
  'usersDelete',
  'leverageMargin',
  'autoClose',
  'withdrawals',
  'qrDeposits',
  'settlement',
  'marketHoliday',
  'manualClose',
  'scriptBan',
  'kiteSetup',
  'tradeOnBehalf',
  'actionLedger',
  'customerSupport',
];

const defaultSubBrokerPermissions = () => SUB_BROKER_FEATURES.reduce((acc, key) => {
  acc[key] = true;
  return acc;
}, {});

const normalizeSubBrokerPermissions = (value = {}) => {
  const defaults = defaultSubBrokerPermissions();
  return Object.keys(defaults).reduce((acc, key) => {
    acc[key] = value?.[key] !== false;
    return acc;
  }, {});
};

const readJsonSetting = async (key, fallback = {}) => {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();

  if (error) throw error;
  if (!data?.value) return fallback;
  if (typeof data.value === 'string') {
    try {
      return JSON.parse(data.value);
    } catch {
      return fallback;
    }
  }
  return data.value;
};

const writeJsonSetting = async (key, value) => {
  const updatedAt = new Date().toISOString();
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key, value: JSON.stringify(value), updated_at: updatedAt }, { onConflict: 'key' });
  if (error) throw error;
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

const calculateLiveTradeValues = (row) => {
  if (!row || row.status !== 'open') return row;

  const marketOpen = isMarketOpen(row.symbol, row.exchange);
  const cached = kiteStreamService.getPrice(row.symbol);
  const liveFresh = marketOpen && getAgeMs(cached?.timestamp) <= QUOTE_FRESHNESS_MS;
  const livePrice = liveFresh ? Number(cached?.last || cached?.ltp || cached?.price || 0) : 0;
  const visiblePrice = toNumber(row._visible_price);
  const currentPrice = livePrice > 0
    ? livePrice
    : (marketOpen
      ? firstPositiveNumber(row.current_price, visiblePrice, row.close_price, row.open_price)
      : firstPositiveNumber(visiblePrice, row.close_price, row.current_price, row.open_price));
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
    _visible_price: undefined,
    current_price: currentPrice,
    profit,
  };
};

const getVisibleSymbolPrice = (symbolData = {}) => {
  const marketOpen = isMarketOpen(symbolData.symbol, symbolData.exchange);
  const live = kiteStreamService.getPrice(symbolData.symbol)
    || kiteStreamService.getPrice(symbolData.kite_tradingsymbol)
    || kiteStreamService.getPrice(symbolData.display_name);
  const liveFresh = marketOpen && getAgeMs(live?.timestamp) <= QUOTE_FRESHNESS_MS;
  const livePrice = liveFresh ? toNumber(live?.last ?? live?.ltp ?? live?.price, 0) : 0;
  if (livePrice > 0) return livePrice;

  return marketOpen
    ? firstPositiveNumber(
      symbolData.last_price,
      symbolData.current_price,
      symbolData.close_price,
      symbolData.previous_close,
      symbolData.bid,
      symbolData.ask,
    )
    : firstPositiveNumber(
      symbolData.close_price,
      symbolData.last_price,
      symbolData.previous_close,
      symbolData.current_price,
      symbolData.bid,
      symbolData.ask,
    );
};

const attachVisibleSymbolPrices = async (rows = []) => {
  const symbols = [...new Set(
    (rows || [])
      .map((row) => String(row?.symbol || '').toUpperCase())
      .filter(Boolean),
  )];
  if (symbols.length === 0) return rows || [];

  const { data, error } = await supabase
    .from('symbols')
    .select('symbol, display_name, kite_tradingsymbol, exchange, last_price, close_price, previous_close, bid, ask, last_update')
    .in('symbol', symbols);

  if (error) throw error;
  const priceBySymbol = new Map(
    (data || []).map((row) => [String(row.symbol || '').toUpperCase(), getVisibleSymbolPrice(row)]),
  );

  return (rows || []).map((row) => ({
    ...row,
    _visible_price: priceBySymbol.get(String(row?.symbol || '').toUpperCase()) || 0,
  }));
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

const firstPositiveNumber = (...values) => {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
};

const normalizeSymbolLookupKey = (value) =>
  String(value || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/-[IVX]+$/i, '')
    .replace(/\d{2}[A-Z]{3}FUT$/i, '')
    .replace(/FUT$/i, '')
    .replace(/[^A-Z0-9]/g, '');

const findSymbolData = async (rawSymbol) => {
  const requested = String(rawSymbol || '').trim().toUpperCase();
  const compact = requested.replace(/\s+/g, '');
  const exactCandidates = [...new Set([requested, compact].filter(Boolean))];

  for (const candidate of exactCandidates) {
    const { data, error } = await supabase
      .from('symbols')
      .select('*')
      .or(`symbol.eq.${candidate},kite_tradingsymbol.eq.${candidate},display_name.eq.${candidate}`)
      .order('expiry_date', { ascending: true })
      .limit(1);
    if (error) throw error;
    if (data?.[0]) return data[0];
  }

  const match = compact.match(/^(.+?)-?([A-Z]{3})$/);
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  if (match && months.includes(match[2])) {
    const baseKey = normalizeSymbolLookupKey(match[1]);
    const { data, error } = await supabase
      .from('symbols')
      .select('*')
      .order('expiry_date', { ascending: true })
      .limit(500);
    if (error) throw error;
    return (data || []).find((row) => {
      const rowBase = normalizeSymbolLookupKey(row.underlying || row.display_name || row.symbol);
      const expiry = row.expiry_date ? new Date(row.expiry_date) : null;
      const rowMonth = expiry && !Number.isNaN(expiry.getTime()) ? months[expiry.getMonth()] : '';
      return rowBase === baseKey && rowMonth === match[2];
    }) || null;
  }

  return null;
};

const getEquivalentSymbols = async (symbolData = {}) => {
  const symbols = new Set([String(symbolData.symbol || '').toUpperCase()].filter(Boolean));

  let query = null;
  if (symbolData.kite_instrument_token) {
    query = supabase
      .from('symbols')
      .select('symbol')
      .eq('kite_instrument_token', symbolData.kite_instrument_token);
  } else if (symbolData.underlying && symbolData.expiry_date) {
    query = supabase
      .from('symbols')
      .select('symbol')
      .eq('underlying', symbolData.underlying)
      .eq('expiry_date', symbolData.expiry_date);
  }

  if (!query) return [...symbols];

  const { data, error } = await query.limit(100);
  if (error) throw error;

  for (const row of data || []) {
    if (row.symbol) symbols.add(String(row.symbol).toUpperCase());
  }

  return [...symbols];
};

const getBestSymbolPrice = (symbolData = {}) => {
  const marketOpen = isMarketOpen(symbolData.symbol, symbolData.exchange);
  const live = kiteStreamService.getPrice(symbolData.symbol)
    || kiteStreamService.getPrice(symbolData.kite_tradingsymbol)
    || kiteStreamService.getPrice(symbolData.display_name);
  const liveFresh = marketOpen && getAgeMs(live?.timestamp) <= QUOTE_FRESHNESS_MS;
  const livePrice = liveFresh ? toNumber(live?.last ?? live?.ltp ?? live?.price, 0) : 0;
  if (livePrice > 0) return livePrice;

  return marketOpen
    ? firstPositiveNumber(
      symbolData.last_price,
      symbolData.current_price,
      symbolData.close_price,
      symbolData.previous_close,
      symbolData.bid,
      symbolData.ask,
    )
    : firstPositiveNumber(
      symbolData.close_price,
      symbolData.last_price,
      symbolData.previous_close,
      symbolData.current_price,
      symbolData.bid,
      symbolData.ask,
    );
};

const firstNonEmptyString = (...values) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const formatDateInIst = (date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
};

const getLastSettlementTarget = (referenceDate = new Date()) => {
  const utcMs = referenceDate.getTime() + referenceDate.getTimezoneOffset() * 60000;
  const ist = new Date(utcMs + 5.5 * 3600000);
  const daysAgo = (ist.getDay() + 1) % 7;
  const lastSat = new Date(ist);
  lastSat.setDate(lastSat.getDate() - daysAgo);
  lastSat.setHours(1, 0, 0, 0);
  return new Date(lastSat.getTime() - 5.5 * 3600000);
};

const getSettlementBalancesByAccount = async (accountIds = []) => {
  const ids = [...new Set((accountIds || []).filter(Boolean))];
  const balances = new Map(ids.map((id) => [id, 0]));
  if (!ids.length) return balances;

  const dealsByAccount = new Map();
  const actualDatesByAccount = new Map();
  const addDeal = (accountId, settlementDate, amount, time) => {
    if (!accountId || !settlementDate) return;
    if (!dealsByAccount.has(accountId)) dealsByAccount.set(accountId, []);
    dealsByAccount.get(accountId).push({
      settlementDate,
      amount: toNumber(amount),
      time: time || `${settlementDate}T01:00:00+05:30`,
    });
  };

  try {
    const { data: settlements, error } = await supabase
      .from('weekly_settlements')
      .select('account_id, settlement_date, created_at, credit_before, profit_loss')
      .in('account_id', ids)
      .order('settlement_date', { ascending: false })
      .limit(10000);

    if (!error) {
      const groups = new Map();
      (settlements || []).forEach((row) => {
        const settlementDate = firstNonEmptyString(
          row.settlement_date,
          row.created_at ? String(row.created_at).slice(0, 10) : '',
        );
        if (!row.account_id || !settlementDate) return;
        const executedAt = row.created_at || `${settlementDate}T01:00:00+05:30`;
        const key = `${row.account_id}::${settlementDate}::${executedAt}`;
        if (!groups.has(key)) {
          groups.set(key, {
            accountId: row.account_id,
            settlementDate,
            time: executedAt,
            creditBefore: toNumber(row.credit_before),
            profitLoss: 0,
          });
        }
        groups.get(key).profitLoss += toNumber(row.profit_loss);
      });

      groups.forEach((group) => {
        if (!actualDatesByAccount.has(group.accountId)) actualDatesByAccount.set(group.accountId, new Set());
        actualDatesByAccount.get(group.accountId).add(group.settlementDate);
        addDeal(group.accountId, group.settlementDate, group.creditBefore, group.time);
      });
    }
  } catch (_) {
    // Optional settlement table may be missing on older databases.
  }

  try {
    const { data: trades, error } = await supabase
      .from('trades')
      .select('account_id, settlement_week, close_time, updated_at, profit, status, is_settlement_close, comment')
      .in('account_id', ids)
      .eq('status', 'closed')
      .limit(10000);

    if (!error) {
      const groups = new Map();
      (trades || [])
        .filter((row) => row.is_settlement_close || /weekly settlement close/i.test(String(row.comment || '')))
        .forEach((row) => {
          const settlementDate = firstNonEmptyString(
            row.settlement_week,
            row.close_time ? String(row.close_time).slice(0, 10) : '',
          );
          if (!row.account_id || !settlementDate) return;
          if (actualDatesByAccount.get(row.account_id)?.has(settlementDate)) return;
          const key = `${row.account_id}::${settlementDate}`;
          if (!groups.has(key)) {
            groups.set(key, {
              accountId: row.account_id,
              settlementDate,
              time: row.close_time || row.updated_at || `${settlementDate}T01:00:00+05:30`,
              profitLoss: 0,
            });
          }
          groups.get(key).profitLoss += toNumber(row.profit);
        });

      groups.forEach((group) => {
        addDeal(group.accountId, group.settlementDate, group.profitLoss, group.time);
      });
    }
  } catch (_) {
    // Fallback settlement-close trades are best-effort only.
  }

  const currentSettlementDate = formatDateInIst(getLastSettlementTarget());
  ids.forEach((accountId) => {
    const deals = (dealsByAccount.get(accountId) || [])
      .sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));
    const currentDeal = deals.find((deal) => deal.settlementDate === currentSettlementDate);
    const selectedDeal = currentDeal || deals[0];
    balances.set(accountId, toNumber(selectedDeal?.amount));
  });

  return balances;
};

const getMissingSchemaColumn = (error) => {
  const message = `${error?.message || ''} ${error?.details || ''}`;
  const schemaCacheMatch = message.match(/Could not find the ['"]([^'"]+)['"] column/i);
  if (schemaCacheMatch) return schemaCacheMatch[1];

  const postgresMatch = message.match(/column (?:[\w]+\.)?["']?([\w]+)["']? does not exist/i);
  return postgresMatch ? postgresMatch[1] : '';
};

const insertSettlementRowsCompat = async (records = []) => {
  let payload = records.map((record) => ({ ...record }));
  const removedColumns = [];

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await supabase
      .from('weekly_settlements')
      .insert(payload)
      .select('id, account_id, user_id, settlement_date, created_at, credit_before');

    if (!result.error) {
      return { ...result, removedColumns };
    }

    const missingColumn = getMissingSchemaColumn(result.error);
    if (!missingColumn || !payload.some((row) => Object.hasOwn(row, missingColumn))) {
      return { ...result, removedColumns };
    }

    removedColumns.push(missingColumn);
    payload = payload.map((row) => {
      const next = { ...row };
      delete next[missingColumn];
      return next;
    });
  }

  return {
    data: null,
    error: new Error('Could not match the weekly_settlements table schema'),
    removedColumns,
  };
};

exports.updateSettlementBalance = async (req, res) => {
  try {
    const { accountId = '', userId = '', settlementDate = '', amount } = req.body || {};
    const nextAmount = Number(amount);

    if (!Number.isFinite(nextAmount)) {
      return res.status(400).json({ success: false, message: 'Balance settled value is required' });
    }

    let accountQuery = supabase
      .from('accounts')
      .select('id, user_id, account_number, is_demo, is_active, balance')
      .limit(1);

    if (accountId) {
      accountQuery = accountQuery.eq('id', accountId);
    } else if (userId) {
      accountQuery = accountQuery
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('is_demo', { ascending: true });
    } else {
      return res.status(400).json({ success: false, message: 'Select a user or account' });
    }

    const { data: accountRows, error: accountError } = await accountQuery;
    if (accountError) throw accountError;

    const account = Array.isArray(accountRows) ? accountRows[0] : accountRows;
    if (!account) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    const cleanSettlementDate = String(settlementDate || '').trim();
    const fetchSettlementRows = async (date = '') => {
      let query = supabase
        .from('weekly_settlements')
        .select('id, account_id, user_id, settlement_date, created_at, credit_before')
        .eq('account_id', account.id)
        .order('settlement_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(500);

      if (date) query = query.eq('settlement_date', date);
      return query;
    };

    let { data: rows, error: rowsError } = await fetchSettlementRows(cleanSettlementDate);
    if (rowsError) throw rowsError;

    // The calendar date chosen by the admin may be the execution date while
    // older rows use settlement_week/settlement_date. Treat it as a preferred
    // date and safely fall back to this account's latest settlement group.
    const usedLatestFallback = !!cleanSettlementDate && !rows?.length;
    if (usedLatestFallback) {
      const latestResult = await fetchSettlementRows();
      rows = latestResult.data;
      rowsError = latestResult.error;
      if (rowsError) throw rowsError;
    }

    let reconstructedRows = false;
    if (!rows?.length) {
      const { data: closedTrades, error: closedTradesError } = await supabase
        .from('trades')
        .select('id, user_id, account_id, symbol, trade_type, quantity, open_price, close_price, current_price, profit, brokerage, buy_brokerage, sell_brokerage, close_time, settlement_week, is_settlement_close, comment')
        .eq('account_id', account.id)
        .eq('status', 'closed')
        .order('close_time', { ascending: false })
        .limit(5000);

      if (closedTradesError) throw closedTradesError;

      const settlementTrades = (closedTrades || []).filter((trade) => (
        trade.is_settlement_close
        || /(?:weekly\s+)?settlement\s+close/i.test(String(trade.comment || ''))
      ));

      const tradeSettlementDate = (trade) => firstNonEmptyString(
        trade.settlement_week,
        trade.close_time ? String(trade.close_time).slice(0, 10) : '',
      );

      let targetTrades = cleanSettlementDate
        ? settlementTrades.filter((trade) => tradeSettlementDate(trade) === cleanSettlementDate)
        : [];

      if (!targetTrades.length && settlementTrades.length) {
        const latestDate = tradeSettlementDate(settlementTrades[0]);
        targetTrades = settlementTrades.filter((trade) => tradeSettlementDate(trade) === latestDate);
      }

      if (targetTrades.length) {
        const targetDate = tradeSettlementDate(targetTrades[0]) || cleanSettlementDate || formatDateInIst(new Date());
        const createdAt = targetTrades[0].close_time || `${targetDate}T01:00:00+05:30`;
        const balance = toNumber(account.balance);
        const records = targetTrades.map((trade) => ({
          user_id: trade.user_id || account.user_id,
          account_id: account.id,
          old_trade_id: trade.id,
          new_trade_id: null,
          settlement_date: targetDate,
          symbol: trade.symbol,
          trade_type: trade.trade_type,
          quantity: toNumber(trade.quantity),
          open_price: toNumber(trade.open_price),
          close_price: toNumber(trade.close_price || trade.current_price || trade.open_price),
          profit_loss: toNumber(trade.profit),
          commission: toNumber(trade.sell_brokerage || trade.brokerage || 0),
          balance_before: balance,
          balance_after: balance,
          credit_before: nextAmount,
          credit_after: 0,
          settlement_type: 'manual_balance_repair',
          created_at: createdAt,
        }));

        const insertResult = await insertSettlementRowsCompat(records);

        if (insertResult.error) throw insertResult.error;
        if (insertResult.removedColumns?.length) {
          console.warn(
            `Settlement history repair used legacy schema; omitted: ${insertResult.removedColumns.join(', ')}`,
          );
        }
        rows = insertResult.data || [];
        reconstructedRows = rows.length > 0;
      }
    }

    if (!rows?.length) {
      return res.status(404).json({
        success: false,
        message: 'No settlement history exists for the selected account',
      });
    }

    const groups = new Map();
    rows.forEach((row) => {
      const date = firstNonEmptyString(
        row.settlement_date,
        row.created_at ? String(row.created_at).slice(0, 10) : '',
      );
      const executedAt = row.created_at || `${date}T01:00:00+05:30`;
      const key = `${row.account_id}::${date}::${executedAt}`;
      if (!groups.has(key)) {
        groups.set(key, {
          accountId: row.account_id,
          settlementDate: date,
          executedAt,
          previousAmount: toNumber(row.credit_before),
          ids: [],
        });
      }
      groups.get(key).ids.push(row.id);
    });

    const latestGroup = [...groups.values()]
      .filter((group) => group.ids.length)
      .sort((a, b) => {
        const dateDiff = new Date(b.settlementDate || 0) - new Date(a.settlementDate || 0);
        if (dateDiff) return dateDiff;
        return new Date(b.executedAt || 0) - new Date(a.executedAt || 0);
      })[0];

    if (!latestGroup) {
      return res.status(404).json({ success: false, message: 'Settlement group not found' });
    }

    const { data: updatedRows, error: updateError } = await supabase
      .from('weekly_settlements')
      .update({ credit_before: nextAmount })
      .in('id', latestGroup.ids)
      .select('id, credit_before');

    if (updateError) throw updateError;

    res.json({
      success: true,
      data: {
        accountId: account.id,
        accountNumber: account.account_number,
        settlementDate: latestGroup.settlementDate,
        executedAt: latestGroup.executedAt,
        previousAmount: latestGroup.previousAmount,
        amount: nextAmount,
        rows: updatedRows?.length || 0,
      },
      message: reconstructedRows
        ? `Missing settlement history was repaired and balance settled was updated for ${latestGroup.settlementDate}`
        : usedLatestFallback
        ? `No settlement was stored for ${cleanSettlementDate}; the latest settlement (${latestGroup.settlementDate}) was updated`
        : 'Balance settled value updated',
    });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
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
    const settlementBalances = await getSettlementBalancesByAccount(accountIds);
    const { data: accounts, error } = await supabase
      .from('accounts')
      .select('id, account_number, is_demo, balance, credit, equity, margin, free_margin, leverage')
      .in('id', accountIds);
    if (error) throw error;
    (accounts || []).forEach((account) => accountMap.set(account.id, {
      ...account,
      settlement_balance: settlementBalances.get(account.id) || 0,
    }));
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
      account_credit: account.credit,
      account_equity: account.equity,
      account_margin: account.margin,
      account_free_margin: account.free_margin,
      account_settlement_balance: account.settlement_balance,
      account_leverage: account.leverage,
    };
  });
};

const getScopedUserIdsForFilter = async (req, scope = 'all', userId = '') => {
  if (scope === 'own') return [req.user.id].filter(Boolean);
  if (scope === 'selected') {
    if (!userId) {
      const err = new Error('Select a user for this export');
      err.status = 400;
      throw err;
    }
    await assertManagedUser(req, userId);
    return [userId];
  }

  const managedIds = await getManagedUserIds(req);
  return Array.isArray(managedIds) ? managedIds : null;
};

const parseIstDateTimeInput = (value) => {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const localDateTime = raw.length === 10
    ? `${raw}T00:00:00`
    : (raw.length === 16 ? `${raw}:00` : raw);
  const normalized = hasTimezone ? raw : `${localDateTime}+05:30`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
};

exports.listSymbols = async (req, res) => {
  try {
    const {
      q = '',
      banned = '',
      active = '',
      limit = 10000,
    } = req.query;

    const maxLimit = Math.min(Number(limit) || 10000, 20000);
    const pageSize = 1000;
    const data = [];

    for (let from = 0; from < maxLimit; from += pageSize) {
      const to = Math.min(from + pageSize - 1, maxLimit - 1);
      let query = supabase
        .from('symbols')
        .select('*')
        .order('underlying', { ascending: true })
        .order('expiry_date', { ascending: true })
        .range(from, to);

      if (active === 'true') query = query.eq('is_active', true);
      if (active === 'false') query = query.eq('is_active', false);
      if (banned === 'true') query = query.eq('is_banned', true);
      if (banned === 'false') query = query.or('is_banned.is.false,is_banned.is.null');
      if (q && q.trim()) {
        const term = q.trim();
        query = query.or(`symbol.ilike.%${term}%,display_name.ilike.%${term}%,underlying.ilike.%${term}%`);
      }

      const { data: pageRows, error } = await query;
      if (error) throw error;
      data.push(...(pageRows || []));
      if (!pageRows || pageRows.length < pageSize) break;
    }

    const symbols = (data || []).map((symbol) => {
      const live = kiteStreamService.getPriceForSymbolRow(symbol);
      const liveFresh = isMarketOpen(symbol.symbol, symbol.exchange) && getAgeMs(live?.timestamp) <= QUOTE_FRESHNESS_MS;
      if (!liveFresh || !live || !toNumber(live.last)) return symbol;
      return {
        ...symbol,
        last_price: toNumber(live.last, symbol.last_price),
        bid: toNumber(live.bid, live.last),
        ask: toNumber(live.ask, live.last),
        change_value: toNumber(live.change, symbol.change_value),
        change_percent: toNumber(live.changePct, symbol.change_percent),
        last_update: live.timestamp ? new Date(Number(live.timestamp)).toISOString() : symbol.last_update,
      };
    });
    res.json({ success: true, data: symbols, symbols });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

exports.actionLedger = async (req, res) => {
  try {
    const {
      from = '',
      to = '',
      scope = 'all',
      userId = '',
      type = 'all',
      limit = 2000,
    } = req.query;

    const scopedUserIds = await getScopedUserIdsForFilter(req, scope, userId);
    if (Array.isArray(scopedUserIds) && scopedUserIds.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const maxRows = Math.min(Number(limit) || 2000, 5000);
    const applyDateRange = (query, column = 'created_at') => {
      let next = query;
      if (from) next = next.gte(column, `${from}T00:00:00.000Z`);
      if (to) next = next.lte(column, `${to}T23:59:59.999Z`);
      return next;
    };
    const applyUserScope = (query) => {
      if (!Array.isArray(scopedUserIds)) return query;
      return query.in('user_id', scopedUserIds);
    };

    let transactionQuery = supabase
      .from('transactions')
      .select('id, user_id, account_id, type, transaction_type, amount, status, description, admin_note, balance_before, balance_after, created_at, updated_at, processed_at')
      .order('created_at', { ascending: false })
      .limit(maxRows);
    transactionQuery = applyDateRange(applyUserScope(transactionQuery), 'created_at');

    let tradeQuery = supabase
      .from('trades')
      .select('id, user_id, account_id, symbol, trade_type, quantity, lot_size, open_price, close_price, current_price, profit, status, brokerage, comment, open_time, close_time, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(maxRows);
    tradeQuery = applyDateRange(applyUserScope(tradeQuery), 'created_at');

    let settlementQuery = supabase
      .from('weekly_settlements')
      .select('*')
      .order('settlement_date', { ascending: false })
      .limit(maxRows);
    settlementQuery = applyUserScope(settlementQuery);
    if (from) settlementQuery = settlementQuery.gte('settlement_date', from);
    if (to) settlementQuery = settlementQuery.lte('settlement_date', to);

    const [transactionsResult, tradesResult, settlementsResult] = await Promise.all([
      transactionQuery,
      tradeQuery,
      settlementQuery,
    ]);
    if (transactionsResult.error) throw transactionsResult.error;
    if (tradesResult.error) throw tradesResult.error;

    const settlementGroups = new Map();
    if (!settlementsResult.error) {
      (settlementsResult.data || []).forEach((row) => {
        const date = firstNonEmptyString(
          row.settlement_date,
          row.created_at ? String(row.created_at).slice(0, 10) : '',
        );
        const executedAt = row.created_at || `${date}T01:00:00+05:30`;
        const key = `${row.account_id || ''}::${date}::${executedAt}`;
        if (!settlementGroups.has(key)) {
          settlementGroups.set(key, {
            id: `settlement-${key}`,
            user_id: row.user_id,
            account_id: row.account_id,
            date: executedAt,
            source: 'Settlement',
            action: 'SETTLEMENT',
            amount: toNumber(row.credit_before),
            status: 'completed',
            tradeCount: 0,
            symbols: new Set(),
          });
        }
        const group = settlementGroups.get(key);
        group.tradeCount += 1;
        if (row.symbol) group.symbols.add(String(row.symbol).toUpperCase());
      });
    }

    const getLedgerType = (row = {}) => {
      const source = String(row.source || '').toLowerCase();
      const action = String(row.action || '').toLowerCase();
      const message = String(row.message || '').toLowerCase();
      const status = String(row.status || '').toLowerCase();

      if (source === 'trade') {
        if (status === 'open' || action.includes('open')) return 'open';
        if (status === 'closed' || action.includes('closed') || action.includes('close')) return 'closed';
        return 'trade';
      }
      if (source === 'settlement' || action.includes('settlement') || message.includes('settlement')) return 'settlement';
      if (action.includes('withdraw') || message.includes('withdraw')) return 'withdrawal';
      if (action.includes('deposit') || message.includes('deposit') || message.includes('fund added')) return 'deposit';
      if (action.includes('adjust') || message.includes('adjust')) return 'adjustment';
      return 'other';
    };

    const matchesLedgerType = (row = {}) => {
      const filter = String(type || 'all').toLowerCase();
      if (!filter || filter === 'all') return true;
      const rowType = getLedgerType(row);
      if (filter === 'trades') return ['open', 'closed', 'trade'].includes(rowType);
      if (filter === 'transactions') return ['deposit', 'withdrawal', 'adjustment', 'other'].includes(rowType);
      return rowType === filter;
    };

    const allRows = [
      ...(transactionsResult.data || []).map((row) => ({
        id: `txn-${row.id}`,
        rawId: row.id,
        user_id: row.user_id,
        account_id: row.account_id,
        date: row.processed_at || row.updated_at || row.created_at,
        source: 'Transaction',
        action: String(row.type || row.transaction_type || 'ledger').toUpperCase(),
        amount: toNumber(row.amount),
        status: row.status || '-',
        message: firstNonEmptyString(row.description, row.admin_note, `${row.type || row.transaction_type || 'Ledger'} ${row.status || ''}`),
        balanceBefore: row.balance_before,
        balanceAfter: row.balance_after,
      })),
      ...(tradesResult.data || []).map((row) => ({
        id: `trade-${row.id}`,
        rawId: row.id,
        user_id: row.user_id,
        account_id: row.account_id,
        date: row.close_time || row.open_time || row.updated_at || row.created_at,
        source: 'Trade',
        action: `${String(row.trade_type || '').toUpperCase()} ${String(row.status || '').toUpperCase()}`.trim(),
        amount: toNumber(row.profit),
        status: row.status || '-',
        message: `${String(row.trade_type || '').toUpperCase()} ${row.quantity || 0} ${row.symbol || ''} @ ${toNumber(row.open_price).toFixed(2)}${row.comment ? ` - ${row.comment}` : ''}`,
        brokerage: row.brokerage,
      })),
      ...[...settlementGroups.values()].map((group) => ({
        ...group,
        message: `Balance settled | ${group.tradeCount} trade${group.tradeCount === 1 ? '' : 's'}${group.symbols.size ? ` | ${[...group.symbols].join(', ')}` : ''}`,
        symbols: undefined,
      })),
    ]
      .map((row) => ({ ...row, ledgerType: getLedgerType(row) }))
      .filter(matchesLedgerType)
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    const enrichedRows = await attachUserAndAccountInfo(allRows);
    res.json({ success: true, data: enrichedRows.slice(0, maxRows) });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

exports.summary = async (req, res) => {
  try {
    const userIds = await getManagedUserIds(req);
    const scoped = Array.isArray(userIds);

    const userQuery = supabase.from('users').select('id, role, is_active');
    const accountQuery = supabase.from('accounts').select('id, user_id, balance, credit, equity, margin, free_margin');
    const openTradeQuery = supabase
      .from('trades')
      .select('id, user_id, account_id, symbol, status, trade_type, quantity, lot_size, open_price, current_price, close_price, profit, margin, buy_brokerage, brokerage, settled_from_trade_id, is_settlement_close')
      .eq('status', 'open');
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
            freeMargin: 0,
            marginLevel: 0,
            openTrades: 0,
            openPnL: 0,
            totalDrCr: 0,
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
    const trades = (await attachVisibleSymbolPrices(filterSupersededSettlementTrades(tradesRes.data || [])))
      .map(calculateLiveTradeValues);
    const liveOpenPnL = trades.reduce((sum, row) => sum + toNumber(row.profit), 0);
    const liveMargin = trades.reduce((sum, row) => sum + toNumber(row.margin), 0);
    const totalBalance = accounts.reduce((sum, row) => sum + toNumber(row.balance), 0);
    const balanceAndCredit = accounts.reduce((sum, row) => sum + toNumber(row.balance) + toNumber(row.credit), 0);
    const liveEquity = balanceAndCredit + liveOpenPnL;
    const txns = txnsRes.data || [];

    res.json({
      success: true,
      data: {
        users: users.filter((u) => u.role !== 'admin' && u.role !== 'sub_broker').length,
        subBrokers: users.filter((u) => u.role === 'sub_broker').length,
        activeUsers: users.filter((u) => u.is_active !== false).length,
        equity: liveEquity,
        margin: liveMargin,
        freeMargin: liveEquity - liveMargin,
        marginLevel: liveMargin > 0 ? (liveEquity / liveMargin) * 100 : 0,
        openTrades: trades.length,
        openPnL: liveOpenPnL,
        totalDrCr: liveEquity - totalBalance,
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
      .select('*')
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
        .select('id, user_id, account_number, is_demo, is_active, balance, credit, equity, margin, free_margin, leverage')
        .in('user_id', userIds);

      if (accountsError) throw accountsError;
      const activeAccounts = (accounts || []).filter((account) => account.is_active !== false);
      const settlementBalances = await getSettlementBalancesByAccount(activeAccounts.map((account) => account.id));

      let liveTrades = [];
      const { data: tradeRows, error: tradesError } = await supabase
        .from('trades')
        .select('id, user_id, account_id, symbol, status, trade_type, quantity, lot_size, open_price, current_price, close_price, profit, margin, buy_brokerage, brokerage, settled_from_trade_id, is_settlement_close')
        .in('user_id', userIds)
        .eq('status', 'open');

      if (tradesError) throw tradesError;
      liveTrades = (await attachVisibleSymbolPrices(filterSupersededSettlementTrades(tradeRows || [])))
        .map(calculateLiveTradeValues);

      const pnlByAccount = new Map();
      const marginByAccount = new Map();
      liveTrades.forEach((trade) => {
        const pnl = toNumber(trade.profit);
        const margin = toNumber(trade.margin);
        pnlByAccount.set(trade.account_id, toNumber(pnlByAccount.get(trade.account_id)) + pnl);
        marginByAccount.set(trade.account_id, toNumber(marginByAccount.get(trade.account_id)) + margin);
      });

      accountsByUserId = activeAccounts.reduce((map, account) => {
        const livePnL = toNumber(pnlByAccount.get(account.id));
        const liveMargin = marginByAccount.has(account.id)
          ? toNumber(marginByAccount.get(account.id))
          : toNumber(account.margin);
        const balance = toNumber(account.balance);
        const credit = toNumber(account.credit);
        const dashboardEquity = balance + credit + livePnL;
        const dashboardFreeMargin = dashboardEquity - liveMargin;
        const enrichedAccount = {
          ...account,
          total_dr_cr: dashboardEquity - balance,
          open_pnl: livePnL,
          dashboard_equity: dashboardEquity,
          dashboard_margin: liveMargin,
          dashboard_free_margin: dashboardFreeMargin,
          dashboard_margin_level: liveMargin > 0 ? (dashboardEquity / liveMargin) * 100 : 0,
          settlement_balance: settlementBalances.get(account.id) || 0,
        };
        if (!map.has(account.user_id)) map.set(account.user_id, []);
        map.get(account.user_id).push(enrichedAccount);
        return map;
      }, new Map());

      (users || []).forEach((user) => {
        user.total_dr_cr = (accountsByUserId.get(user.id) || [])
          .reduce((sum, account) => sum + toNumber(account.total_dr_cr), 0);
      });
    }

    res.json({
      success: true,
      data: (users || []).map((user) => {
        const { password_hash, plain_password, ...safeUser } = user;
        return {
          ...safeUser,
          current_password: plain_password || '',
          accounts: accountsByUserId.get(user.id) || [],
        };
      }),
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
    const targetIsAdmin = targetRole === 'admin';

    const leverageNum = Number(leverage) || 30;
    if (!isAllowedLeverage(leverageNum)) {
      return res.status(400).json({
        success: false,
        message: `Unsupported leverage. Allowed: ${getAllowedLeverageOptions().join(', ')}`,
      });
    }

    if (!targetIsAdmin && !createDemo && !createLive) {
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

    let ownerId = isSubBroker(req) ? req.user.id : (createdBy || null);
    if (ownerId && isAdmin(req)) {
      const { data: broker, error: brokerError } = await supabase
        .from('users')
        .select('id, role')
        .eq('id', ownerId)
        .eq('role', 'sub_broker')
        .maybeSingle();
      if (brokerError) throw brokerError;
      if (!broker) return res.status(400).json({ success: false, message: 'Selected owner must be a sub broker' });
    }
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
        liquidation_type: liquidationType === 'illiquidate' ? 'illiquidate' : 'liquidate',
      }])
      .select()
      .single();

    if (error) throw error;
    await rememberPlainPassword(user.id, String(password || 'TA1234'));

    const accountsToCreate = [];
    if (!targetIsAdmin && createDemo) {
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

    if (!targetIsAdmin && createLive) {
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
      message: `${targetRole === 'admin' ? 'Admin' : targetRole === 'sub_broker' ? 'Sub broker' : 'User'} created successfully`,
      data: { user, loginId: cleanLoginId, tempPassword: password || 'TA1234' },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteDemoAccount = async (req, res) => {
  try {
    const { accountId } = req.params;

    const { data: account, error } = await supabase
      .from('accounts')
      .select('id, user_id, is_demo, account_number')
      .eq('id', accountId)
      .single();

    if (error || !account) return res.status(404).json({ success: false, message: 'Account not found' });
    if (!account.is_demo) return res.status(400).json({ success: false, message: 'Only demo accounts can be deleted here' });

    await assertManagedUser(req, account.user_id);

    const { count, error: openError } = await supabase
      .from('trades')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('status', 'open');
    if (openError) throw openError;
    if (count > 0) return res.status(400).json({ success: false, message: 'Close open demo positions before deleting this account' });

    const { error: updateError } = await supabase
      .from('accounts')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', accountId);
    if (updateError) throw updateError;

    res.json({ success: true, message: 'Demo account deleted' });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

exports.getAutoCloseSettings = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'web_auto_close_settings')
      .maybeSingle();
    if (error) throw error;
    const value = typeof data?.value === 'string'
      ? JSON.parse(data.value)
      : data?.value || { percent: 90, applyAll: true, userId: '', userIds: [], userSettings: [] };
    res.json({ success: true, data: value });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.saveAutoCloseSettings = async (req, res) => {
  try {
    const userIds = Array.isArray(req.body?.userIds)
      ? req.body.userIds.filter(Boolean)
      : Array.isArray(req.body?.selectedUserIds)
        ? req.body.selectedUserIds.filter(Boolean)
        : req.body?.userId
          ? [req.body.userId]
          : [];
    const userSettings = Array.isArray(req.body?.userSettings)
      ? req.body.userSettings
          .filter((item) => item?.userId)
          .map((item) => ({ userId: item.userId, percent: Number(item.percent || req.body?.percent || 90) }))
      : userIds.map((userId) => ({ userId, percent: Number(req.body?.percent || 90) }));
    const payload = {
      percent: Number(req.body?.percent || 90),
      applyAll: req.body?.applyAll !== false,
      userId: req.body?.applyAll === false ? userIds[0] || '' : '',
      userIds: req.body?.applyAll === false ? userIds : [],
      selectedUserIds: req.body?.applyAll === false ? userIds : [],
      userSettings: req.body?.applyAll === false ? userSettings : [],
      updatedAt: new Date().toISOString(),
    };
    const { error } = await supabase
      .from('app_settings')
      .upsert({ key: 'web_auto_close_settings', value: JSON.stringify(payload), updated_at: payload.updatedAt }, { onConflict: 'key' });
    if (error) throw error;
    res.json({ success: true, data: payload, message: 'Auto close settings saved' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getSubBrokerFeaturePermissions = async (req, res) => {
  try {
    const brokerId = isAdmin(req) ? (req.query?.brokerId || req.user.id) : req.user.id;
    const settings = await readJsonSetting(SUB_BROKER_PERMISSIONS_KEY, {});
    const permissions = normalizeSubBrokerPermissions(settings?.[brokerId] || {});
    res.json({ success: true, data: { brokerId, permissions, features: SUB_BROKER_FEATURES } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.saveSubBrokerFeaturePermissions = async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ success: false, message: 'Only admin can update sub broker permissions' });
    }

    const { brokerId, permissions = {} } = req.body || {};
    if (!brokerId) return res.status(400).json({ success: false, message: 'Sub broker is required' });

    const { data: broker, error: brokerError } = await supabase
      .from('users')
      .select('id, role')
      .eq('id', brokerId)
      .eq('role', 'sub_broker')
      .maybeSingle();

    if (brokerError) throw brokerError;
    if (!broker) return res.status(404).json({ success: false, message: 'Sub broker not found' });

    const settings = await readJsonSetting(SUB_BROKER_PERMISSIONS_KEY, {});
    settings[brokerId] = normalizeSubBrokerPermissions(permissions);
    await writeJsonSetting(SUB_BROKER_PERMISSIONS_KEY, settings);

    res.json({ success: true, data: { brokerId, permissions: settings[brokerId] }, message: 'Sub broker permissions saved' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getUserSegmentSettings = async (req, res) => {
  try {
    const { id } = req.params;
    await assertManagedUser(req, id);
    const settings = await readJsonSetting('web_user_segment_settings', {});
    res.json({ success: true, data: settings[id] || {} });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

exports.saveUserSegmentSettings = async (req, res) => {
  try {
    const { id } = req.params;
    await assertManagedUser(req, id);
    const { segment = '', values = {} } = req.body || {};
    if (!segment) return res.status(400).json({ success: false, message: 'Segment is required' });

    const settings = await readJsonSetting('web_user_segment_settings', {});
    settings[id] = {
      ...(settings[id] || {}),
      [segment]: {
        ...values,
        updatedAt: new Date().toISOString(),
        updatedBy: req.user.id,
      },
    };
    await writeJsonSetting('web_user_segment_settings', settings);
    res.json({ success: true, data: settings[id][segment], message: 'Segment settings saved' });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

exports.getUserScriptSettings = async (req, res) => {
  try {
    const { id } = req.params;
    await assertManagedUser(req, id);
    const settings = await readJsonSetting('web_user_script_settings', {});
    res.json({ success: true, data: settings[id] || [] });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

exports.saveUserScriptSettings = async (req, res) => {
  try {
    const { id } = req.params;
    await assertManagedUser(req, id);
    const payload = req.body || {};
    const symbol = String(payload.symbol || '').trim().toUpperCase();
    if (!symbol) return res.status(400).json({ success: false, message: 'Symbol is required' });

    const settings = await readJsonSetting('web_user_script_settings', {});
    const currentRows = Array.isArray(settings[id]) ? settings[id] : [];
    const row = {
      id: payload.id || `${symbol}:${Date.now()}`,
      segment: payload.segment || 'NSE',
      symbol,
      settingType: payload.settingType || 'Value Settings',
      perOrderValue: Number(payload.perOrderValue || 0),
      maxValueHolding: Number(payload.maxValueHolding || 0),
      fixOptSellHo: Number(payload.fixOptSellHo || 0),
      fixOptSellInt: Number(payload.fixOptSellInt || 0),
      updatedAt: new Date().toISOString(),
      updatedBy: req.user.id,
    };

    const existingIndex = currentRows.findIndex((item) => String(item.id) === String(row.id) || String(item.symbol).toUpperCase() === symbol);
    const nextRows = [...currentRows];
    if (existingIndex >= 0) nextRows[existingIndex] = { ...nextRows[existingIndex], ...row };
    else nextRows.push(row);

    settings[id] = nextRows;
    await writeJsonSetting('web_user_script_settings', settings);
    res.json({ success: true, data: nextRows, message: 'Script settings saved' });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

exports.copyUserSettings = async (req, res) => {
  try {
    const { id } = req.params;
    await assertManagedUser(req, id);
    const { sourceUserId } = req.body || {};
    if (!sourceUserId) return res.status(400).json({ success: false, message: 'User to copy from is required' });
    await assertManagedUser(req, sourceUserId);
    if (String(sourceUserId) === String(id)) {
      return res.status(400).json({ success: false, message: 'Select a different user to copy from' });
    }

    const segmentSettings = await readJsonSetting('web_user_segment_settings', {});
    const scriptSettings = await readJsonSetting('web_user_script_settings', {});

    segmentSettings[id] = segmentSettings[sourceUserId] || {};
    scriptSettings[id] = Array.isArray(scriptSettings[sourceUserId])
      ? scriptSettings[sourceUserId].map((item) => ({
        ...item,
        id: `${item.symbol || 'script'}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
        copiedFrom: sourceUserId,
        updatedAt: new Date().toISOString(),
        updatedBy: req.user.id,
      }))
      : [];

    await writeJsonSetting('web_user_segment_settings', segmentSettings);
    await writeJsonSetting('web_user_script_settings', scriptSettings);

    const { data: sourceUser, error: sourceError } = await supabase
      .from('users')
      .select('*')
      .eq('id', sourceUserId)
      .maybeSingle();
    if (sourceError) throw sourceError;

    const copiedColumns = [];
    const skippedColumns = [];
    if (sourceUser) {
      const columnsToCopy = [
        'leverage',
        'brokerage_rate',
        'max_saved_accounts',
        'closing_mode',
        'liquidation_type',
      ];

      for (const column of columnsToCopy) {
        if (sourceUser[column] === undefined) continue;
        const { error: columnError } = await supabase
          .from('users')
          .update({ [column]: sourceUser[column] })
          .eq('id', id);

        if (columnError) {
          const message = `${columnError.message || ''} ${columnError.details || ''}`;
          if (/column|schema cache|does not exist/i.test(message)) {
            skippedColumns.push(column);
            console.warn(`copy settings skipped ${column}:`, columnError.message);
            continue;
          }
          throw columnError;
        }

        copiedColumns.push(column);
      }

      const { error: touchError } = await supabase
        .from('users')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', id);
      if (touchError && !/updated_at|column|schema cache|does not exist/i.test(`${touchError.message || ''} ${touchError.details || ''}`)) {
        throw touchError;
      }
    }

    res.json({
      success: true,
      data: { copiedColumns, skippedColumns },
      message: 'Copy settings saved',
    });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

exports.getGlobalLeverageMarginSettings = async (req, res) => {
  try {
    const data = await readJsonSetting('web_global_leverage_margin_settings', {});
    res.json({ success: true, data });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

exports.saveGlobalLeverageMarginSettings = async (req, res) => {
  try {
    const payload = {
      groups: req.body?.groups || {},
      updatedAt: new Date().toISOString(),
      updatedBy: req.user.id,
    };
    await writeJsonSetting('web_global_leverage_margin_settings', payload);
    res.json({ success: true, data: payload, message: 'Global settings saved' });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
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

exports.userWriteAccess = async (req, res, next) => {
  try {
    await assertManagedUser(req, req.params.id);
    next();
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
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
      .select('id, symbol, exchange, trade_type, quantity, open_price, current_price, profit, margin, brokerage, user_id, account_id, open_time, stop_loss, take_profit, comment, settled_from_trade_id, is_settlement_close')
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
    const liveRows = (await attachVisibleSymbolPrices(filterSupersededSettlementTrades(data || [])))
      .map(calculateLiveTradeValues);
    res.json({ success: true, data: liveRows });
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
      offset = 0,
    } = req.query;

    if (userId) await assertManagedUser(req, userId);

    let query = supabase
      .from('trades')
      .select('id, symbol, exchange, trade_type, quantity, lot_size, open_price, close_price, current_price, profit, margin, brokerage, buy_brokerage, sell_brokerage, user_id, account_id, open_time, close_time, stop_loss, take_profit, comment, status, created_at, updated_at, settled_from_trade_id, is_settlement_close')
      .order(status === 'closed' ? 'close_time' : 'open_time', { ascending: false });

    const pageSize = Math.min(Math.max(Number(limit) || 1000, 1), 2000);
    const from = Math.max(Number(offset) || 0, 0);
    query = query.range(from, from + pageSize - 1);

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
    const visibleRows = status === 'open'
      ? filterSupersededSettlementTrades(data || [])
      : (data || []);
    const liveRows = (await attachVisibleSymbolPrices(visibleRows)).map(calculateLiveTradeValues);
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
      includeEntryBrokerage = true,
      includeExitBrokerage = true,
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

    const symbolData = await findSymbolData(symbol);
    if (!symbolData) {
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
    const shouldApplyEntryBrokerage = includeEntryBrokerage !== false;
    const brokerage = shouldApplyEntryBrokerage ? price * qty * lotSize * brokerageRate : 0;
    const requestedEntryTime = parseIstDateTimeInput(entryTime);
    const now = requestedEntryTime && !Number.isNaN(requestedEntryTime.getTime())
      ? requestedEntryTime.toISOString()
      : new Date().toISOString();
    const accountEquity = Number(account.equity ?? (Number(account.balance || 0) + Number(account.credit || 0)));
    const accountNewMargin = Number(account.margin || 0) + marginRequired;
    const suppliedCurrent = Number(currentPrice || 0);
    const quoteCurrent = getBestSymbolPrice(symbolData);
    const marketOpen = isMarketOpen(symbolData.symbol, symbolData.exchange || 'NSE');
    const current = marketOpen
      ? (suppliedCurrent || quoteCurrent || price)
      : (quoteCurrent || suppliedCurrent || price);
    const direction = tradeType === 'sell' ? -1 : 1;
    const equivalentSymbols = await getEquivalentSymbols(symbolData);
    const { data: existingTrades, error: existingError } = await supabase
      .from('trades')
      .select('*')
      .eq('account_id', account.id)
      .eq('trade_type', tradeType)
      .eq('status', 'open')
      .in('symbol', equivalentSymbols)
      .order('open_time', { ascending: true })
      .limit(1);

    if (existingError) throw existingError;

    const existingTrade = existingTrades?.[0] || null;
    if (existingTrade) {
      const existingQty = Number(existingTrade.quantity || 0);
      const existingPrice = Number(existingTrade.open_price || 0);
      const mergedQty = existingQty + qty;
      const mergedPrice = mergedQty > 0
        ? ((existingPrice * existingQty) + (price * qty)) / mergedQty
        : price;
      const mergedBrokerage = Number(existingTrade.buy_brokerage ?? existingTrade.brokerage ?? 0) + brokerage;
      const mergedMargin = Number(existingTrade.margin || 0) + marginRequired;
      const mergedProfit = ((current - mergedPrice) * direction * mergedQty * lotSize) - mergedBrokerage;
      const entryEvents = [
        ...ensureTradeEntryHistory(existingTrade),
        buildTradeEntryEvent({
          action: 'add',
          time: now,
          quantity: qty,
          price,
          commission: brokerage,
        }),
      ];

      const { data: updatedTrade, error: updateTradeError } = await supabase
        .from('trades')
        .update({
          quantity: mergedQty,
          open_price: mergedPrice,
          current_price: current,
          margin: mergedMargin,
          brokerage: mergedBrokerage,
          buy_brokerage: mergedBrokerage,
          profit: mergedProfit,
          stop_loss: Number(stopLoss) || Number(existingTrade.stop_loss || 0),
          take_profit: Number(takeProfit) || Number(existingTrade.take_profit || 0),
          comment: mergeTradeCommentEvents(existingTrade.comment || '', entryEvents),
          updated_at: now,
        })
        .eq('id', existingTrade.id)
        .select()
        .single();

      if (updateTradeError) throw updateTradeError;

      const { error: updateAccountError } = await supabase
        .from('accounts')
        .update({
          margin: accountNewMargin,
          free_margin: accountEquity - accountNewMargin,
          updated_at: now,
        })
        .eq('id', account.id);

      if (updateAccountError) throw updateAccountError;

      return res.json({
        success: true,
        merged: true,
        data: updatedTrade,
        message: `${tradeType.toUpperCase()} ${symbolData.symbol} merged for selected user`,
      });
    }

    const initialProfit = ((current - price) * direction * qty * lotSize) - brokerage;
    const tradeData = {
      user_id: userId,
      account_id: account.id,
      symbol: symbolData.symbol,
      exchange: symbolData.exchange || 'NSE',
      trade_type: tradeType,
      quantity: qty,
      open_price: price,
      current_price: current,
      stop_loss: Number(stopLoss) || 0,
      take_profit: Number(takeProfit) || 0,
      margin: marginRequired,
      brokerage,
      buy_brokerage: brokerage,
      sell_brokerage: 0,
      profit: initialProfit,
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
        margin: accountNewMargin,
        free_margin: accountEquity - accountNewMargin,
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
