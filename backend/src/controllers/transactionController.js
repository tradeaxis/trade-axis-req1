const { supabase } = require('../config/supabase');
const paymentService = require('../services/paymentService');

// GET /api/transactions/razorpay-key  (public)
const getRazorpayKey = (req, res) => {
  return res.status(200).json({
    success: true,
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

module.exports = {
  getRazorpayKey,
  createDeposit,
  verifyDeposit,
  withdraw,
  getTransactions,
  getTransaction,
};