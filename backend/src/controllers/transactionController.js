// backend/src/controllers/transactionController.js
const { supabase } = require('../config/supabase');
const paymentService = require('../services/paymentService');

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
    if (status) query = query.eq('status', status);

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

    const visibleTrades = (trades || []).filter(tradeMatchesPeriod);
    const visibleTradeChainKeys = new Set(visibleTrades.map(buildTradeChainKey));

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

    tradeChains.forEach((chain) => {
      if (!visibleTradeChainKeys.has(chain.key)) return;

      const rows = [...chain.rows];
      const entryTrade =
        rows.reduce((best, row) => {
          const rowQty = Number(row.original_quantity || row.quantity || 0);
          const bestQty = Number(best?.original_quantity || best?.quantity || 0);
          if (rowQty > bestQty) return row;
          if (rowQty < bestQty) return best;

          const bestTime = new Date(best?.updated_at || best?.close_time || best?.open_time || 0).getTime();
          const rowTime = new Date(row?.updated_at || row?.close_time || row?.open_time || 0).getTime();
          return rowTime < bestTime ? row : best;
        }, rows[0]) || rows[0];

      const entryQuantity = rows.reduce(
        (maxQty, row) => Math.max(maxQty, Number(row.original_quantity || row.quantity || 0)),
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

      rows
        .filter((row) => row.status === 'closed' && row.close_time)
        .filter(tradeMatchesPeriod)
        .sort((a, b) => new Date(a.close_time) - new Date(b.close_time))
        .forEach((trade) => {
          const closedQty = Number(trade.quantity || 0);
          const originalQty = Number(trade.original_quantity || trade.quantity || 0);

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

        // 3) Weekly settlements (if table exists)
    try {
      const { data: settlements } = await supabase
        .from('weekly_settlements')
        .select('*')
        .eq('account_id', accountId)
        .order('settlement_date', { ascending: false })
        .limit(100);

      (settlements || []).forEach((s) => {
        if (startDate && new Date(s.settlement_date) < startDate) return;
        allDeals.push({
          id: `settlement-${s.id}`,
          source: 'settlement',
          side: 'settlement',
          type: 'settlement',
          dealLabel: 'Weekly Settlement',
          symbol: s.symbol,
          quantity: s.quantity,
          price: s.close_price,
          amount: Number(s.profit_loss || 0),
          profit: Number(s.profit_loss || 0),
          commission: Number(s.commission || 0),
          time: s.settlement_date,
          status: 'completed',
          balance_before: s.balance_before,
          balance_after: s.balance_after,
        });
      });
    } catch (e) {
      // weekly_settlements table may not exist — skip silently
    }

    // Sort latest first
    allDeals.sort((a, b) => new Date(b.time) - new Date(a.time));

    const deals = allDeals.slice(0, parseInt(limit, 10));

    const exitDeals = allDeals.filter((d) => d.source === 'trade' && d.side === 'exit');

    const summary = {
      totalProfit: exitDeals.filter((d) => d.amount > 0).reduce((s, d) => s + d.amount, 0),
      totalLoss: Math.abs(exitDeals.filter((d) => d.amount < 0).reduce((s, d) => s + d.amount, 0)),
      totalDeposits: allDeals.filter((d) => d.type === 'deposit').reduce((s, d) => s + d.amount, 0),
      totalWithdrawals: Math.abs(allDeals.filter((d) => d.type === 'withdrawal').reduce((s, d) => s + d.amount, 0)),
      totalCommission: allDeals.reduce((s, d) => s + Number(d.commission || 0), 0),
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
  withdraw,
  getTransactions,
  getTransaction,
  getDeals, // ✅ NEW
};
