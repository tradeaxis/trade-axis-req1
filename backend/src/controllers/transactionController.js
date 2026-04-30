// backend/src/controllers/transactionController.js
const { supabase } = require('../config/supabase');
const paymentService = require('../services/paymentService');
const { getTradeEntryEvents } = require('../utils/tradeCommentEvents');

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

const normalizeQrSettings = (raw = {}, fallback = {}) => {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
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
  const upiId = firstNonEmptyString(source.upiId, source.upi_id, base.upiId, base.upi_id);
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
  const bankName = firstNonEmptyString(source.bankName, source.bank_name, base.bankName, base.bank_name);
  const accountNumber = firstNonEmptyString(
    source.accountNumber,
    source.account_number,
    base.accountNumber,
    base.account_number,
  );
  const ifscCode = firstNonEmptyString(source.ifscCode, source.ifsc_code, base.ifscCode, base.ifsc_code);
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

  const settingsByKey = new Map(
    (data || []).map((row) => [row.key, parseAppSettingValue(row.value)]),
  );

  for (const key of QR_SETTINGS_KEYS) {
    const value = settingsByKey.get(key);
    if (value) {
      return normalizeQrSettings(value);
    }
  }

  return normalizeQrSettings({});
};

const buildQrDepositReference = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${QR_DEPOSIT_REFERENCE_PREFIX}${timestamp}${random}`;
};

const buildQrDepositDescription = ({ paymentReference = '', note = '' } = {}) => {
  const parts = [QR_DEPOSIT_DESCRIPTION_PREFIX];
  if (paymentReference) parts.push(`Ref: ${paymentReference}`);
  if (note) parts.push(`Note: ${note}`);
  return parts.join(' | ');
};

const buildSettlementTimestamp = (settlementDate, fallback = null) => (
  fallback || (settlementDate ? `${settlementDate}T01:00:00+05:30` : null)
);

const buildSettlementDeals = (settlements = []) => {
  const groups = new Map();

  (settlements || []).forEach((row) => {
    const settlementDate = firstNonEmptyString(
      row.settlement_date,
      row.created_at ? String(row.created_at).slice(0, 10) : '',
    );
    if (!settlementDate) return;

    const accountId = row.account_id || 'unknown';
    const key = `${accountId}::${settlementDate}`;

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        settlementDate,
        executedAt: row.created_at || row.updated_at || null,
        balanceBefore: row.balance_before ?? null,
        balanceAfter: row.balance_after ?? row.balance_before ?? null,
        creditBefore: Number(row.credit_before || 0),
        totalProfitLoss: 0,
        totalCommission: 0,
        tradeCount: 0,
        symbols: new Set(),
      });
    }

    const group = groups.get(key);
    group.totalProfitLoss += Number(row.profit_loss || 0);
    group.totalCommission += Number(row.commission || 0);
    group.tradeCount += 1;

    if (row.symbol) {
      group.symbols.add(String(row.symbol).toUpperCase());
    }
    if (!group.executedAt && (row.created_at || row.updated_at)) {
      group.executedAt = row.created_at || row.updated_at;
    }
    if (group.balanceBefore === null && row.balance_before !== undefined) {
      group.balanceBefore = row.balance_before;
    }
    if (group.balanceAfter === null && row.balance_after !== undefined) {
      group.balanceAfter = row.balance_after;
    }
  });

  return Array.from(groups.values())
    .map((group) => {
      const amount = Number((group.creditBefore + group.totalProfitLoss).toFixed(2));
      const symbolCount = group.symbols.size;
      const description = [
        `${group.tradeCount} trade${group.tradeCount === 1 ? '' : 's'} settled`,
        symbolCount > 0 ? `${symbolCount} symbol${symbolCount === 1 ? '' : 's'}` : '',
      ]
        .filter(Boolean)
        .join(' | ');

      return {
        id: `settlement-${group.key}`,
        source: 'settlement',
        side: 'settlement',
        type: 'settlement',
        dealLabel: 'Balance Settled',
        symbol: null,
        quantity: null,
        price: null,
        amount,
        profit: amount,
        commission: Number(group.totalCommission || 0),
        time: buildSettlementTimestamp(group.settlementDate, group.executedAt),
        status: 'completed',
        description,
        balance_before: group.balanceBefore,
        balance_after: group.balanceAfter,
        settlement_date: group.settlementDate,
        trade_count: group.tradeCount,
      };
    })
    .sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));
};

const getTransactionStatusAliases = (status) => {
  const normalized = String(status || '').trim().toLowerCase();
  if (!normalized) {
    return [];
  }

  if (REJECTED_TRANSACTION_STATUSES.includes(normalized)) {
    return REJECTED_TRANSACTION_STATUSES;
  }

  return [normalized];
};

// GET /api/transactions/razorpay-key (public)
const getRazorpayKey = (req, res) => {
  return res.status(200).json({
    success: true,
    enabled: paymentService.isRazorpayEnabled(),
    key: paymentService.getRazorpayKey(),
  });
};

// POST /api/transactions/deposit/create (protected)
const createDeposit = async (req, res) => {
  try {
    const { accountId, amount } = req.body;

    const order = await paymentService.createDepositOrder(
      req.user.id,
      accountId,
      Number(amount)
    );

    return res.status(200).json({
      success: true,
      data: order,
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

// POST /api/transactions/deposit/verify (protected)
const verifyDeposit = async (req, res) => {
  try {
    const { orderId, paymentId, signature } = req.body;

    const transaction = await paymentService.confirmDeposit(
      orderId,
      paymentId,
      signature
    );

    return res.status(200).json({
      success: true,
      message: 'Deposit successful',
      data: transaction,
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

// GET /api/transactions/qr-settings (protected)
const getQrSettings = async (req, res) => {
  try {
    const settings = await readQrSettings();

    return res.status(200).json({
      success: true,
      data: settings,
      settings,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/transactions/withdraw (protected)
const withdraw = async (req, res) => {
  try {
    const { accountId, amount, bankName, accountNumber, ifscCode, accountHolderName } = req.body;

    const txn = await paymentService.createWithdrawalRequest(
      req.user.id,
      accountId,
      Number(amount),
      { bankName, accountNumber, ifscCode, accountHolderName }
    );

    return res.status(200).json({
      success: true,
      message: 'Withdrawal request submitted',
      data: txn,
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

// POST /api/transactions/qr-deposit-request (protected)
const createQrDepositRequest = async (req, res) => {
  try {
    const { accountId, amount, paymentReference, note } = req.body;
    const depositAmount = Number(amount);
    const normalizedReference = String(paymentReference || '').trim();
    const normalizedNote = String(note || '').trim();

    if (!accountId) {
      return res.status(400).json({ success: false, message: 'accountId is required' });
    }
    if (!depositAmount || depositAmount < 100 || depositAmount > 1000000) {
      return res.status(400).json({
        success: false,
        message: 'amount must be between 100 and 1000000',
      });
    }
    if (!normalizedReference) {
      return res.status(400).json({
        success: false,
        message: 'paymentReference is required',
      });
    }

    const qrSettings = await readQrSettings();
    if (!qrSettings.enabled || !(qrSettings.qrImage || qrSettings.upiId || qrSettings.accountNumber)) {
      return res.status(400).json({
        success: false,
        message: 'QR deposit is not available right now',
      });
    }

    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select('*')
      .eq('id', accountId)
      .eq('user_id', req.user.id)
      .single();

    if (accountError || !account) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }
    if (account.is_demo) {
      return res.status(400).json({ success: false, message: 'Cannot deposit to demo account' });
    }

    const { data: txn, error: insertError } = await supabase
      .from('transactions')
      .insert([
        {
          user_id: req.user.id,
          account_id: accountId,
          transaction_type: 'deposit',
          type: 'deposit',
          amount: depositAmount,
          payment_method: 'bank_transfer',
          status: 'pending',
          reference: buildQrDepositReference(),
          balance_before: account.balance,
          description: buildQrDepositDescription({
            paymentReference: normalizedReference,
            note: normalizedNote,
          }),
        },
      ])
      .select()
      .single();

    if (insertError) throw insertError;

    return res.status(200).json({
      success: true,
      message: 'QR deposit request submitted. Balance will update after admin approval.',
      data: txn,
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

// GET /api/transactions (protected)
const getTransactions = async (req, res) => {
  try {
    const { accountId, type, status, limit = 50 } = req.query;

    let query = supabase
      .from('transactions')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit, 10));

    if (accountId) query = query.eq('account_id', accountId);
    if (type) query = query.eq('transaction_type', type);

    const statusValues = getTransactionStatusAliases(status);
    if (statusValues.length === 1) {
      query = query.eq('status', statusValues[0]);
    } else if (statusValues.length > 1) {
      query = query.in('status', statusValues);
    }

    const { data, error } = await query;
    if (error) throw error;

    return res.status(200).json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/transactions/:id (protected)
const getTransaction = async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ NEW: GET /api/transactions/deals (protected)
// Returns combined deals: closed trades (profit), deposits, withdrawals, commissions
const buildTradeChainKey = (trade) => {
  const symbol = String(trade?.symbol || '').toUpperCase();
  const side = String(trade?.trade_type || '').toLowerCase();
  const openTime = trade?.open_time || trade?.created_at || trade?.updated_at || trade?.id || '';
  return `${symbol}::${side}::${openTime}`;
};

const inferEntryCommission = (trade) => {
  if (trade?.buy_brokerage !== undefined && trade?.buy_brokerage !== null) {
    return Number(trade.buy_brokerage || 0);
  }

  const totalBrokerage = Number(trade?.brokerage || 0);
  const sellBrokerage = Number(trade?.sell_brokerage || 0);

  if (sellBrokerage > 0) {
    return Math.max(0, totalBrokerage - sellBrokerage);
  }

  return totalBrokerage;
};

const inferExitCommission = (trade) => {
  if (trade?.sell_brokerage !== undefined && trade?.sell_brokerage !== null) {
    return Number(trade.sell_brokerage || 0);
  }

  return 0;
};

const inferOriginalQuantity = (trade) => {
  const explicit = Number(trade?.original_quantity);
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }

  const comment = String(trade?.comment || '');
  const partialMatch = comment.match(/partial close:\s*([\d.]+)\s+of\s+([\d.]+)/i);
  if (partialMatch) {
    const parsed = Number(partialMatch[2]);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return Number(trade?.quantity || 0);
};

const isTimestampWithinPeriod = (value, startDate) => {
  if (!startDate) return true;
  if (!value) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed >= startDate;
};

const extractChainEntryEvents = (rows = []) => {
  const candidate = [...rows]
    .map((row) => ({
      row,
      entryEvents: getTradeEntryEvents(row?.comment),
      scoreTime: new Date(row?.updated_at || row?.close_time || row?.open_time || 0).getTime(),
    }))
    .filter((item) => item.entryEvents.length > 0)
    .sort((a, b) => {
      if (b.entryEvents.length !== a.entryEvents.length) {
        return b.entryEvents.length - a.entryEvents.length;
      }
      return b.scoreTime - a.scoreTime;
    })[0];

  return candidate?.entryEvents || [];
};

const getDeals = async (req, res) => {
  try {
    const { accountId, period = 'month', limit = 200 } = req.query;
    const userId = req.user.id;

    if (!accountId) {
      return res.status(400).json({ success: false, message: 'accountId is required' });
    }

    const now = new Date();
    let startDate = null;

    switch (period) {
      case 'today':
        startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'week':
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate = new Date(now);
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case '3months':
        startDate = new Date(now);
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case '6months':
        startDate = new Date(now);
        startDate.setMonth(startDate.getMonth() - 6);
        break;
      case 'year':
        startDate = new Date(now);
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate = null;
    }

    const allDeals = [];
    const normalizeTxnType = (txn) =>
      String(txn.transaction_type || txn.type || '').toLowerCase();

    // Get account balance
    const { data: account } = await supabase
      .from('accounts')
      .select('balance')
      .eq('id', accountId)
      .single();

    // 1) TRADES - include OPEN + CLOSED so entry commission shows immediately
    const { data: trades, error: tradesError } = await supabase
      .from('trades')
      .select('*')
      .eq('account_id', accountId)
      .eq('user_id', userId)
      .order('open_time', { ascending: false })
      .limit(1000);

    if (tradesError) throw tradesError;

    const tradeMatchesPeriod = (trade) => {
      if (!startDate) return true;
      const openOk = trade.open_time && new Date(trade.open_time) >= startDate;
      const closeOk = trade.close_time && new Date(trade.close_time) >= startDate;
      return openOk || closeOk;
    };

    const tradeChains = new Map();

    (trades || []).forEach((trade) => {
      const chainKey = buildTradeChainKey(trade);

      if (!tradeChains.has(chainKey)) {
        tradeChains.set(chainKey, {
          key: chainKey,
          symbol: trade.symbol,
          tradeType: trade.trade_type,
          openTime: trade.open_time,
          rows: [],
        });
      }

      tradeChains.get(chainKey).rows.push(trade);
    });

    const visibleTradeChainKeys = new Set();

    tradeChains.forEach((chain, chainKey) => {
      const hasTradeTimestampInPeriod = chain.rows.some(tradeMatchesPeriod);
      const hasEntryEventInPeriod = extractChainEntryEvents(chain.rows)
        .some((event) => isTimestampWithinPeriod(event.time, startDate));

      if (!startDate || hasTradeTimestampInPeriod || hasEntryEventInPeriod) {
        visibleTradeChainKeys.add(chainKey);
      }
    });

    tradeChains.forEach((chain) => {
      if (!visibleTradeChainKeys.has(chain.key)) return;

      const rows = [...chain.rows];
      const entryTrade =
        rows.reduce((best, row) => {
          const rowQty = inferOriginalQuantity(row);
          const bestQty = inferOriginalQuantity(best);
          if (rowQty > bestQty) return row;
          if (rowQty < bestQty) return best;

          const bestTime = new Date(best?.updated_at || best?.close_time || best?.open_time || 0).getTime();
          const rowTime = new Date(row?.updated_at || row?.close_time || row?.open_time || 0).getTime();
          return rowTime < bestTime ? row : best;
        }, rows[0]) || rows[0];

      const parsedEntryEvents = extractChainEntryEvents(rows);

      if (parsedEntryEvents.length > 0) {
        parsedEntryEvents
          .filter((event) => isTimestampWithinPeriod(event.time, startDate))
          .sort((a, b) => new Date(a.time) - new Date(b.time))
          .forEach((event, index) => {
            allDeals.push({
              id: `entry-${chain.key}-${index}`,
              source: 'trade',
              side: 'entry',
              type: chain.tradeType,
              dealLabel: chain.tradeType === 'buy' ? 'Buy In' : 'Sell In',
              symbol: chain.symbol,
              quantity: Number(event.quantity || 0),
              original_quantity: Number(event.quantity || 0),
              price: Number(event.price || 0),
              amount: 0,
              profit: 0,
              commission: Number(event.commission || 0),
              time: event.time,
              status: 'completed',
              tradeId: entryTrade?.id,
            });
          });
      } else if (isTimestampWithinPeriod(chain.openTime || entryTrade?.open_time, startDate)) {
        const entryQuantity = rows.reduce(
          (maxQty, row) => Math.max(maxQty, inferOriginalQuantity(row)),
          0,
        );
        const entryCommission = rows.reduce(
          (sum, row) => sum + inferEntryCommission(row),
          0,
        );

        allDeals.push({
          id: `entry-${chain.key}`,
          source: 'trade',
          side: 'entry',
          type: chain.tradeType,
          dealLabel: chain.tradeType === 'buy' ? 'Buy In' : 'Sell In',
          symbol: chain.symbol,
          quantity: entryQuantity,
          original_quantity: entryQuantity,
          price: Number(entryTrade?.open_price || 0),
          amount: 0,
          profit: 0,
          commission: entryCommission,
          time: chain.openTime || entryTrade?.open_time,
          status: 'completed',
          tradeId: entryTrade?.id,
        });
      }

      rows
        .filter((row) => row.status === 'closed' && row.close_time)
        .filter(tradeMatchesPeriod)
        .sort((a, b) => new Date(a.close_time) - new Date(b.close_time))
        .forEach((trade) => {
          const closedQty = Number(trade.quantity || 0);
          const originalQty = inferOriginalQuantity(trade);

          allDeals.push({
            id: `exit-${trade.id}`,
            source: 'trade',
            side: 'exit',
            type: trade.trade_type === 'buy' ? 'sell' : 'buy',
            dealLabel: trade.trade_type === 'buy' ? 'Sell Out' : 'Buy Out',
            symbol: trade.symbol,
            quantity: closedQty,
            closed_quantity: closedQty,
            original_quantity: originalQty,
            price: Number(trade.close_price || 0),
            amount: Number(trade.profit || 0),
            profit: Number(trade.profit || 0),
            commission: inferExitCommission(trade),
            time: trade.close_time,
            status: 'completed',
            tradeId: trade.id,
          });
        });
    });

    // 2) Deposits / Withdrawals
    const { data: txns, error: txnsError } = await supabase
      .from('transactions')
      .select('*')
      .eq('account_id', accountId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(500);

    if (txnsError) throw txnsError;

    const filteredTxns = (txns || []).filter((txn) => {
      if (!startDate) return true;
      return txn.created_at && new Date(txn.created_at) >= startDate;
    });

    filteredTxns.forEach((txn) => {
      const txnType = normalizeTxnType(txn);
      const txnStatus = String(txn.status || '').toLowerCase();
      const isCompleted = !txnStatus || ['completed', 'approved', 'processed'].includes(txnStatus);
      if (!isCompleted) return;

      const amount = Number(txn.amount || 0);
      const description = txn.description || txn.note || '';
      const time = txn.processed_at || txn.created_at;
      const isAdminAdjustment = /admin/i.test(description);

      if (txnType === 'deposit') {
        allDeals.push({
          id: `deposit-${txn.id}`,
          source: 'transaction',
          side: 'deposit',
          type: 'deposit',
          dealLabel: isAdminAdjustment ? 'Fund Added' : 'Deposit',
          symbol: null,
          quantity: null,
          price: null,
          amount,
          profit: 0,
          commission: 0,
          time,
          status: txn.status,
          transactionId: txn.id,
          description,
          balance_before: txn.balance_before,
          balance_after: txn.balance_after,
        });
        return;
      }

      if (['withdraw', 'withdrawal'].includes(txnType)) {
        allDeals.push({
          id: `withdrawal-${txn.id}`,
          source: 'transaction',
          side: 'withdrawal',
          type: 'withdrawal',
          dealLabel: isAdminAdjustment ? 'Fund Reduced' : 'Withdrawal',
          symbol: null,
          quantity: null,
          price: null,
          amount: -amount,
          profit: 0,
          commission: 0,
          time,
          status: txn.status,
          transactionId: txn.id,
          description,
          balance_before: txn.balance_before,
          balance_after: txn.balance_after,
        });
        return;
      }

      if (amount !== 0) {
        allDeals.push({
          id: `adjustment-${txn.id}`,
          source: 'transaction',
          side: amount >= 0 ? 'deposit' : 'withdrawal',
          type: amount >= 0 ? 'deposit' : 'withdrawal',
          dealLabel: description || (amount >= 0 ? 'Adjustment Credit' : 'Adjustment Debit'),
          symbol: null,
          quantity: null,
          price: null,
          amount,
          profit: 0,
          commission: 0,
          time,
          status: txn.status,
          transactionId: txn.id,
          description,
          balance_before: txn.balance_before,
          balance_after: txn.balance_after,
        });
      }
    });

    // 3) Weekly settlements (grouped into one entry per settlement run)
    try {
      const { data: settlements } = await supabase
        .from('weekly_settlements')
        .select('*')
        .eq('account_id', accountId)
        .order('settlement_date', { ascending: false })
        .limit(100);

      const settlementDeals = buildSettlementDeals(settlements || []).filter((deal) => {
        if (!startDate) return true;
        return deal.time && new Date(deal.time) >= startDate;
      });

      allDeals.push(...settlementDeals);
    } catch (e) {
      // weekly_settlements table may not exist — skip silently
    }

    // Sort latest first
    allDeals.sort((a, b) => new Date(b.time) - new Date(a.time));

    const deals = allDeals.slice(0, parseInt(limit, 10));

    const exitDeals = allDeals.filter((d) => d.source === 'trade' && d.side === 'exit');
    const settlementDeals = allDeals.filter((d) => d.source === 'settlement');

    const summary = {
      totalProfit: exitDeals.filter((d) => d.amount > 0).reduce((s, d) => s + d.amount, 0),
      totalLoss: Math.abs(exitDeals.filter((d) => d.amount < 0).reduce((s, d) => s + d.amount, 0)),
      totalDeposits: allDeals.filter((d) => d.type === 'deposit').reduce((s, d) => s + d.amount, 0),
      totalWithdrawals: Math.abs(allDeals.filter((d) => d.type === 'withdrawal').reduce((s, d) => s + d.amount, 0)),
      totalCommission: allDeals.reduce((s, d) => s + Number(d.commission || 0), 0),
      balanceSettled: Number(settlementDeals[0]?.amount || 0),
      netPnL: exitDeals.reduce((s, d) => s + d.amount, 0),
      currentBalance: Number(account?.balance || 0),
    };

    return res.status(200).json({
      success: true,
      data: {
        deals,
        summary,
        period,
        count: deals.length,
      },
    });
  } catch (error) {
    console.error('getDeals error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getRazorpayKey,
  createDeposit,
  verifyDeposit,
  getQrSettings,
  createQrDepositRequest,
  withdraw,
  getTransactions,
  getTransaction,
  getDeals, // ✅ NEW
};
