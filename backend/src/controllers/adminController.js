// backend/src/controllers/adminController.js
const { supabase } = require('../config/supabase');
const { hashPassword, generateAccountNumber } = require('../utils/auth');

const randomPassword = (len = 12) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#$_';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
};

// ---------------- USERS ----------------
const listUsers = async (req, res) => {
  try {
    const { q = '', limit = 200 } = req.query;

    let query = supabase
      .from('users')
      .select('id, email, first_name, last_name, phone, role, is_active, is_verified, created_at, last_login')
      .order('created_at', { ascending: false })
      .limit(Number(limit) || 200);

    if (q.trim()) query = query.ilike('email', `%${q.trim().toLowerCase()}%`);

    const { data, error } = await query;
    if (error) throw error;

    return res.json({ success: true, data: data || [] });
  } catch (e) {
    console.error('admin.listUsers:', e);
    return res.status(500).json({ success: false, message: 'Failed to list users' });
  }
};

const createUser = async (req, res) => {
  try {
    const {
      email,
      firstName,
      lastName,
      phone,
      role = 'user',
      password,
      leverage = 5,
      demoBalance = 100000,
      createDemo = true,
      createLive = true,
    } = req.body;

    if (!email || !firstName || !lastName) {
      return res.status(400).json({ success: false, message: 'email, firstName, lastName are required' });
    }

    const normalizedEmail = String(email).toLowerCase().trim();

    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', normalizedEmail)
      .single();

    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Email already registered' });
    }

    const tempPassword = password?.trim() ? password.trim() : randomPassword(12);
    const hashedPassword = await hashPassword(tempPassword);

    const { data: user, error: userError } = await supabase
      .from('users')
      .insert([{
        email: normalizedEmail,
        password_hash: hashedPassword,
        first_name: firstName,
        last_name: lastName,
        phone: phone || null,
        role: role === 'admin' ? 'admin' : 'user',
        is_verified: false,
        is_active: true,
      }])
      .select('id, email, first_name, last_name, phone, role, is_active, created_at')
      .single();

    if (userError) throw userError;

    const createdAccounts = [];

    if (createDemo) {
      const demoAccountNumber = generateAccountNumber(true);
      const { data: demoAcc, error: demoErr } = await supabase
        .from('accounts')
        .insert([{
          user_id: user.id,
          account_number: demoAccountNumber,
          account_type: 'demo',
          balance: Number(demoBalance) || 100000,
          equity: Number(demoBalance) || 100000,
          free_margin: Number(demoBalance) || 100000,
          leverage: Number(leverage) || 5,
          currency: 'INR',
          is_demo: true,
          is_active: true,
        }])
        .select()
        .single();

      if (demoErr) console.error('Admin demo account creation error:', demoErr);
      else createdAccounts.push(demoAcc);
    }

    if (createLive) {
      const liveAccountNumber = generateAccountNumber(false);
      const { data: liveAcc, error: liveErr } = await supabase
        .from('accounts')
        .insert([{
          user_id: user.id,
          account_number: liveAccountNumber,
          account_type: 'standard',
          balance: 0,
          equity: 0,
          free_margin: 0,
          leverage: Number(leverage) || 5,
          currency: 'INR',
          is_demo: false,
          is_active: true,
        }])
        .select()
        .single();

      if (liveErr) console.error('Admin live account creation error:', liveErr);
      else createdAccounts.push(liveAcc);
    }

    return res.status(201).json({
      success: true,
      message: 'User created',
      data: { user, accounts: createdAccounts, tempPassword },
    });
  } catch (e) {
    console.error('admin.createUser:', e);
    return res.status(500).json({ success: false, message: 'Failed to create user', error: e.message });
  }
};

const setUserActive = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ success: false, message: 'isActive must be boolean' });
    }

    const { data, error } = await supabase
      .from('users')
      .update({ is_active: isActive })
      .eq('id', id)
      .select('id, email, is_active')
      .single();

    if (error) throw error;

    return res.json({ success: true, message: 'User status updated', data });
  } catch (e) {
    console.error('admin.setUserActive:', e);
    return res.status(500).json({ success: false, message: 'Failed to update user' });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;

    const newPass = password?.trim() ? password.trim() : randomPassword(12);
    const hashed = await hashPassword(newPass);

    const { data, error } = await supabase
      .from('users')
      .update({ password_hash: hashed })
      .eq('id', id)
      .select('id, email')
      .single();

    if (error) throw error;

    return res.json({
      success: true,
      message: 'Password reset',
      data: { user: data, tempPassword: newPass },
    });
  } catch (e) {
    console.error('admin.resetPassword:', e);
    return res.status(500).json({ success: false, message: 'Failed to reset password' });
  }
};

// ---------------- WITHDRAWALS (ADMIN WALLET OPS) ----------------

// GET /api/admin/withdrawals?status=pending
const listWithdrawals = async (req, res) => {
  try {
    const { status = 'pending', limit = 200 } = req.query;

    // support both naming conventions
    const types = ['withdraw', 'withdrawal'];

    let q = supabase
      .from('transactions')
      .select('*')
      .in('transaction_type', types)
      .order('created_at', { ascending: false })
      .limit(Number(limit) || 200);

    if (status && status !== 'all') q = q.eq('status', status);

    const { data, error } = await q;
    if (error) throw error;

    return res.json({ success: true, data: data || [] });
  } catch (e) {
    console.error('admin.listWithdrawals:', e);
    return res.status(500).json({ success: false, message: 'Failed to list withdrawals' });
  }
};

// POST /api/admin/withdrawals/:id/approve
// MVP: mark completed + (optionally) deduct funds now
const approveWithdrawal = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { id } = req.params;
    const { note = '' } = req.body;

    const { data: txn, error: txnErr } = await supabase
      .from('transactions')
      .select('*')
      .eq('id', id)
      .single();

    if (txnErr || !txn) {
      return res.status(404).json({ success: false, message: 'Withdrawal not found' });
    }

    if (!['pending', 'processing'].includes(String(txn.status))) {
      return res.status(400).json({ success: false, message: `Cannot approve status: ${txn.status}` });
    }

    // OPTIONAL: Deduct now (safe if your withdrawal request did NOT already deduct)
    // If your paymentService already reserves funds on request, tell me and we'll switch logic.
    const amount = Number(txn.amount || 0);
    if (amount <= 0) return res.status(400).json({ success: false, message: 'Invalid amount' });

    const { data: account, error: accErr } = await supabase
      .from('accounts')
      .select('*')
      .eq('id', txn.account_id)
      .single();

    if (accErr || !account) {
      return res.status(400).json({ success: false, message: 'Account not found for withdrawal' });
    }

    // Check funds
    const freeMargin = Number(account.free_margin || 0);
    if (amount > freeMargin) {
      return res.status(400).json({ success: false, message: `Insufficient funds. Free margin ₹${freeMargin.toFixed(2)}` });
    }

    // Update transaction -> completed
    const now = new Date().toISOString();

    const { data: updatedTxn, error: upErr } = await supabase
      .from('transactions')
      .update({
        status: 'completed',
        processed_by: adminId,
        processed_at: now,
        admin_note: note || null,
      })
      .eq('id', id)
      .select()
      .single();

    if (upErr) throw upErr;

    // Deduct from account
    const newBalance = Math.max(0, Number(account.balance || 0) - amount);
    const newFreeMargin = Math.max(0, Number(account.free_margin || 0) - amount);
    const newEquity = Math.max(0, Number(account.equity || 0) - amount);

    const { error: accUpErr } = await supabase
      .from('accounts')
      .update({
        balance: newBalance,
        free_margin: newFreeMargin,
        equity: newEquity,
        updated_at: now,
      })
      .eq('id', account.id);

    if (accUpErr) throw accUpErr;

    return res.json({
      success: true,
      message: 'Withdrawal approved and completed',
      data: updatedTxn,
    });
  } catch (e) {
    console.error('admin.approveWithdrawal:', e);
    return res.status(500).json({ success: false, message: 'Failed to approve withdrawal', error: e.message });
  }
};

// POST /api/admin/withdrawals/:id/reject
const rejectWithdrawal = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { id } = req.params;
    const { note = '' } = req.body;

    const { data: txn, error: txnErr } = await supabase
      .from('transactions')
      .select('*')
      .eq('id', id)
      .single();

    if (txnErr || !txn) {
      return res.status(404).json({ success: false, message: 'Withdrawal not found' });
    }

    if (!['pending', 'processing'].includes(String(txn.status))) {
      return res.status(400).json({ success: false, message: `Cannot reject status: ${txn.status}` });
    }

    const now = new Date().toISOString();

    const { data: updatedTxn, error: upErr } = await supabase
      .from('transactions')
      .update({
        status: 'rejected',
        processed_by: adminId,
        processed_at: now,
        admin_note: note || null,
      })
      .eq('id', id)
      .select()
      .single();

    if (upErr) throw upErr;

    return res.json({
      success: true,
      message: 'Withdrawal rejected',
      data: updatedTxn,
    });
  } catch (e) {
    console.error('admin.rejectWithdrawal:', e);
    return res.status(500).json({ success: false, message: 'Failed to reject withdrawal', error: e.message });
  }
};

module.exports = {
  listUsers,
  createUser,
  setUserActive,
  resetPassword,
  listWithdrawals,
  approveWithdrawal,
  rejectWithdrawal,
};