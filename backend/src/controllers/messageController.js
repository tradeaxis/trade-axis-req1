const { supabase } = require('../config/supabase');

const pickUserName = (user = {}) =>
  [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email || user.login_id || 'User';

exports.listUserMessages = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('support_messages')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createUserMessage = async (req, res) => {
  try {
    const title = String(req.body.title || 'Support Query').trim();
    const content = String(req.body.content || req.body.message || '').trim();
    if (!content) {
      return res.status(400).json({ success: false, message: 'Message is required' });
    }

    const { data, error } = await supabase
      .from('support_messages')
      .insert({
        user_id: req.user.id,
        sender_id: req.user.id,
        sender_role: 'user',
        title,
        content,
        status: 'open',
      })
      .select('*')
      .single();

    if (error) throw error;
    res.json({ success: true, data, message: 'Message sent' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.markUserMessagesRead = async (req, res) => {
  try {
    const { error } = await supabase
      .from('support_messages')
      .update({ user_read_at: new Date().toISOString() })
      .eq('user_id', req.user.id)
      .is('user_read_at', null);

    if (error) throw error;
    res.json({ success: true, message: 'Messages marked read' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.listSupportMessages = async (req, res) => {
  try {
    let query = supabase
      .from('support_messages')
      .select('*, users:user_id(id, login_id, email, first_name, last_name, role)')
      .order('created_at', { ascending: false })
      .limit(500);

    if (req.user.role === 'sub_broker') {
      const { data: clients, error: clientError } = await supabase
        .from('users')
        .select('id')
        .eq('created_by', req.user.id);
      if (clientError) throw clientError;
      const clientIds = (clients || []).map((row) => row.id);
      if (!clientIds.length) return res.json({ success: true, data: [] });
      query = query.in('user_id', clientIds);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json({
      success: true,
      data: (data || []).map((row) => ({
        ...row,
        user_name: pickUserName(row.users),
        user_login_id: row.users?.login_id || row.users?.email || '',
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.sendSupportReply = async (req, res) => {
  try {
    const title = String(req.body.title || 'Trade Axis Support').trim();
    const content = String(req.body.content || req.body.message || '').trim();
    const recipientUserId = req.body.userId || req.body.recipientUserId;
    if (!content) return res.status(400).json({ success: false, message: 'Message is required' });
    if (!recipientUserId) return res.status(400).json({ success: false, message: 'Select a user' });

    const { data, error } = await supabase
      .from('support_messages')
      .insert({
        user_id: recipientUserId,
        sender_id: req.user.id,
        sender_role: req.user.role === 'sub_broker' ? 'sub_broker' : 'admin',
        title,
        content,
        status: 'answered',
        admin_read_at: new Date().toISOString(),
      })
      .select('*')
      .single();

    if (error) throw error;
    res.json({ success: true, data, message: 'Message sent' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.sendSupportBroadcast = async (req, res) => {
  try {
    const title = String(req.body.title || 'Trade Axis Support').trim();
    const content = String(req.body.content || req.body.message || '').trim();
    if (!content) return res.status(400).json({ success: false, message: 'Message is required' });

    let query = supabase
      .from('users')
      .select('id')
      .eq('role', 'user')
      .eq('is_active', true);

    if (req.user.role === 'sub_broker') {
      query = query.eq('created_by', req.user.id);
    }

    const { data: users, error: userError } = await query;
    if (userError) throw userError;

    const rows = (users || []).map((user) => ({
      user_id: user.id,
      sender_id: req.user.id,
      sender_role: req.user.role === 'sub_broker' ? 'sub_broker' : 'admin',
      title,
      content,
      status: 'answered',
      admin_read_at: new Date().toISOString(),
    }));

    if (!rows.length) return res.json({ success: true, data: [], message: 'No users found' });

    const { data, error } = await supabase
      .from('support_messages')
      .insert(rows)
      .select('*');

    if (error) throw error;
    res.json({ success: true, data, message: `Message sent to ${rows.length} user(s)` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.markSupportRead = async (req, res) => {
  try {
    const { error } = await supabase
      .from('support_messages')
      .update({ admin_read_at: new Date().toISOString() })
      .is('admin_read_at', null);
    if (error) throw error;
    res.json({ success: true, message: 'Support messages marked read' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
