// frontend/src/components/admin/AdminUsers.jsx
import { useEffect, useState, useCallback } from 'react';
import api from '../../services/api';
import { toast } from 'react-hot-toast';
import { 
  ChevronDown, 
  ChevronUp, 
  Settings, 
  RefreshCw, 
  Lock, 
  Unlock, 
  Copy, 
  Plus,
  X,
  Wallet,
  Trash2,
  AlertTriangle,
} from 'lucide-react';

const DEFAULT_LEVERAGE_OPTIONS = [1, 2, 5, 10, 20, 25, 30, 40, 50, 100, 200, 300, 500, 1000];

export default function AdminUsers() {
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState([]);
  const [expandedUserId, setExpandedUserId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [leverageOptions, setLeverageOptions] = useState(DEFAULT_LEVERAGE_OPTIONS);

  // Add Money Modal State
  const [addMoneyModal, setAddMoneyModal] = useState(null);
  const [addMoneyAmount, setAddMoneyAmount] = useState('');
  const [addMoneyNote, setAddMoneyNote] = useState('');
  const [addMoneyLoading, setAddMoneyLoading] = useState(false);
  const [equityModal, setEquityModal] = useState(null);
  const [equityAmount, setEquityAmount] = useState('');
  const [equityLoading, setEquityLoading] = useState(false);
  const [leverageModal, setLeverageModal] = useState(null);
  const [selectedLeverage, setSelectedLeverage] = useState(DEFAULT_LEVERAGE_OPTIONS[0]);

  // Create user form — Name is OPTIONAL, only Unique ID + Pass required
  // ✅ FIX 6a: Added liquidationType field
  const [form, setForm] = useState({
    loginId: '',
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    role: 'user',
    password: '',
    leverage: 30,
    maxSavedAccounts: 10,
    brokerageRate: '0.06',
    demoBalance: 100000,
    createDemo: true,
    createLive: true,
    liquidationType: 'liquidate', // ✅ NEW: 'liquidate' or 'illiquidate'
  });

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/admin/users?limit=500&q=${searchQuery}`);
      if (res.data?.success) {
        const userData = res.data.data || res.data.users || [];
        setUsers(userData);
      } else {
        setUsers([]);
      }
    } catch (e) {
      console.error('Load users error:', e);
      toast.error(e.response?.data?.message || 'Failed to load users');
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    const loadLeverageOptions = async () => {
      try {
        const res = await api.get('/admin/leverage-options');
        const options = Array.isArray(res.data?.options) && res.data.options.length > 0
          ? res.data.options.map((value) => Number(value)).filter((value) => Number.isFinite(value))
          : DEFAULT_LEVERAGE_OPTIONS;
        setLeverageOptions(options);
        setForm((prev) => ({
          ...prev,
          leverage: options.includes(prev.leverage)
            ? prev.leverage
            : (options.includes(30) ? 30 : options[0] || prev.leverage),
        }));
      } catch (_) {
        setLeverageOptions(DEFAULT_LEVERAGE_OPTIONS);
      }
    };

    loadLeverageOptions();
  }, []);

  const copyLoginId = (loginId) => {
    if (!loginId) return;
    navigator.clipboard.writeText(loginId);
    toast.success(`Copied: ${loginId}`);
  };

  const createUser = async () => {
    if (!form.loginId || !form.loginId.trim()) {
      return toast.error('User ID is required');
    }
    if (!form.createDemo && !form.createLive) {
      return toast.error('Select at least one account type (Demo or Live)');
    }

    // Parse brokerage from percentage string to decimal
    const brokerageDecimal = parseFloat(form.brokerageRate) / 100;
    if (isNaN(brokerageDecimal) || brokerageDecimal < 0) {
      return toast.error('Enter a valid brokerage rate');
    }

    try {
      const res = await api.post('/admin/users', {
        loginId: form.loginId.trim().toUpperCase(),
        email: form.email || undefined,
        firstName: form.firstName || '',
        lastName: form.lastName || '',
        phone: form.phone || '',
        role: form.role,
        password: form.password || 'TA1234',
        leverage: Number(form.leverage),
        brokerageRate: brokerageDecimal,
        maxSavedAccounts: Number(form.maxSavedAccounts),
        demoBalance: Number(form.demoBalance),
        createDemo: form.createDemo,
        createLive: form.createLive,
        liquidationType: form.liquidationType, // ✅ NEW: pass liquidation type
      });
      
      if (res.data?.success) {
        const data = res.data.data;
        const tempPassword = data?.tempPassword;
        const loginId = data?.loginId;
        
        toast.success('User created successfully!');

        if (loginId && tempPassword) {
          const credentials = `Login ID: ${loginId}\nPassword: ${tempPassword}`;
          window.prompt('User credentials (copy now):', credentials);
        } else if (loginId) {
          window.prompt('Login ID:', loginId);
        }

        // ✅ FIX 6a: Reset form including liquidationType
        setForm({
          loginId: '',
          firstName: '',
          lastName: '',
          phone: '',
          email: '',
          role: 'user',
          password: '',
          leverage: leverageOptions.includes(30) ? 30 : leverageOptions[0] || 30,
          maxSavedAccounts: 10,
          brokerageRate: '0.06',
          demoBalance: 100000,
          createDemo: true,
          createLive: true,
          liquidationType: 'liquidate',
        });

        loadUsers();
      } else {
        toast.error(res.data?.message || 'Create user failed');
      }
    } catch (e) {
      console.error('Create user error:', e);
      toast.error(e.response?.data?.message || 'Create user failed');
    }
  };

  const toggleActive = async (u) => {
    if (u.role === 'admin') {
      const confirmCode = window.prompt(
        'This is an ADMIN account. Enter "CONFIRM" to proceed with deactivation/activation:'
      );
      if (confirmCode !== 'CONFIRM') {
        return toast.error('Admin account action cancelled');
      }
    }

    try {
      await api.patch(`/admin/users/${u.id}/active`, { isActive: !u.is_active });
      toast.success(u.is_active ? 'User deactivated' : 'User activated');
      loadUsers();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Update failed');
    }
  };

  const toggleClosingMode = async (u) => {
    try {
      const newMode = !u.closing_mode;
      await api.patch(`/admin/users/${u.id}/closing-mode`, { closingMode: newMode });
      toast.success(newMode 
        ? 'Closing mode ON - User can only close positions' 
        : 'Closing mode OFF - User can trade normally'
      );
      loadUsers();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Update failed');
    }
  };

  const resetPassword = async (u) => {
    try {
      const res = await api.post(`/admin/users/${u.id}/reset-password`, {});
      const tempPassword = res.data?.data?.tempPassword;
      toast.success('Password reset');
      if (tempPassword) {
        window.prompt(`New password for ${u.login_id || u.email}:`, tempPassword);
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Reset failed');
    }
  };

  const deleteUser = async (u) => {
    if (!window.confirm(`Are you sure you want to DELETE user ${u.login_id || u.email}? This cannot be undone.`)) return;
    const confirmCode = window.prompt('Type "DELETE" to confirm:');
    if (confirmCode !== 'DELETE') {
      return toast.error('Delete cancelled');
    }

    try {
      await api.delete(`/admin/users/${u.id}`);
      toast.success(`User ${u.login_id || u.email} deleted`);
      loadUsers();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Delete failed');
    }
  };

  const updateLeverage = async (userId, accountId, leverage) => {
    try {
      await api.patch(`/admin/users/${userId}/leverage`, { 
        leverage: Number(leverage),
        accountId 
      });
      toast.success(`Leverage updated to 1:${leverage}`);
      loadUsers();
      return true;
    } catch (e) {
      toast.error(e.response?.data?.message || 'Update leverage failed');
      return false;
    }
  };

  const updateEquity = async (userId, accountId, equity) => {
    try {
      const numericEquity = Number(equity);
      await api.patch(`/admin/users/${userId}/equity`, {
        accountId,
        equity: numericEquity,
      });
      toast.success(`Equity updated to ${numericEquity.toLocaleString('en-IN')}`);
      loadUsers();
      return true;
    } catch (e) {
      toast.error(e.response?.data?.message || 'Update equity failed');
      return false;
    }
  };

  const updateBrokerageRate = async (userId, brokerageRate) => {
    try {
      await api.patch(`/admin/users/${userId}/brokerage`, { 
        brokerageRate: Number(brokerageRate)
      });
      toast.success(`Brokerage updated to ${(Number(brokerageRate) * 100).toFixed(4)}%`);
      loadUsers();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Update brokerage failed');
    }
  };

  // ✅ FIX 5: handleAddMoney stays the same
  const handleAddMoney = async () => {
    if (!addMoneyModal || !addMoneyAmount || Number(addMoneyAmount) <= 0) {
      return toast.error('Enter a valid amount');
    }

    const isReduce = addMoneyModal.mode === 'reduce';

    setAddMoneyLoading(true);
    try {
      const res = await api.post(`/admin/users/${addMoneyModal.user.id}/add-balance`, {
        accountId: addMoneyModal.account.id,
        amount: isReduce ? -Number(addMoneyAmount) : Number(addMoneyAmount),
        note: addMoneyNote || (isReduce ? 'Admin reduction' : 'Admin deposit - Cash received offline'),
      });

      if (res.data?.success) {
        toast.success(`${Number(addMoneyAmount).toLocaleString('en-IN')} ${isReduce ? 'reduced from' : 'added to'} ${addMoneyModal.account.account_number}`);
        setAddMoneyModal(null);
        setAddMoneyAmount('');
        setAddMoneyNote('');
        loadUsers();
      } else {
        toast.error(res.data?.message || 'Failed to add money');
      }
    } catch (e) {
      console.error('Add money error:', e);
      toast.error(e.response?.data?.message || 'Failed to add money');
    } finally {
      setAddMoneyLoading(false);
    }
  };

  const openEquityModal = (user, account) => {
    setEquityAmount(String(Number(account.equity || 0)));
    setEquityModal({ user, account });
  };

  const openLeverageModal = (user, account) => {
    setSelectedLeverage(Number(account.leverage || leverageOptions[0] || 1));
    setLeverageModal({ user, account });
  };

  const handleUpdateEquity = async () => {
    if (!equityModal || equityAmount === '' || Number.isNaN(Number(equityAmount))) {
      return toast.error('Enter a valid equity value');
    }

    setEquityLoading(true);
    try {
      const success = await updateEquity(
        equityModal.user.id,
        equityModal.account.id,
        equityAmount,
      );

      if (success) {
        setEquityModal(null);
        setEquityAmount('');
      }
    } finally {
      setEquityLoading(false);
    }
  };

  const handleUpdateLeverage = async () => {
    if (!leverageModal || !selectedLeverage) {
      return toast.error('Select leverage');
    }

    const success = await updateLeverage(
      leverageModal.user.id,
      leverageModal.account.id,
      selectedLeverage,
    );

    if (success) {
      setLeverageModal(null);
    }
  };

  // ✅ FIX 5: AddMoneyModal component REMOVED — rendered inline below instead
  // This fixes the single-digit input bug caused by React re-mounting the
  // component on every parent render (because the function identity changes).

  return (
    <div className="h-full flex flex-col" style={{ background: '#1e222d' }}>
      <div className="p-4 border-b" style={{ borderColor: '#363a45' }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-bold" style={{ color: '#d1d4dc' }}>
              Admin • Users
            </div>
            <div className="text-xs mt-1" style={{ color: '#787b86' }}>
              Manage users, leverage, brokerage & closing mode
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search TA1000..."
              className="px-3 py-2 rounded text-sm w-32"
              style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#d1d4dc' }}
              onKeyDown={(e) => e.key === 'Enter' && loadUsers()}
            />
            <button
              onClick={loadUsers}
              className="p-2 rounded-lg flex items-center gap-2 text-sm"
              style={{ background: '#2a2e39', color: '#d1d4dc' }}
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* Create user form */}
        <div className="p-4 rounded-lg mb-4" style={{ background: '#2a2e39', border: '1px solid #363a45' }}>
          <div className="text-sm font-semibold mb-3" style={{ color: '#d1d4dc' }}>
            Create New User
          </div>

          <div className="grid grid-cols-1 gap-2">
            {/* User ID — set by admin, must be unique */}
            <div>
              <label className="text-xs mb-1 block font-medium" style={{ color: '#2962ff' }}>User ID *</label>
              <input
                value={form.loginId || ''}
                onChange={(e) => setForm((p) => ({ ...p, loginId: e.target.value.toUpperCase() }))}
                placeholder="Enter User ID"
                className="px-3 py-2.5 rounded text-sm font-mono font-bold"
                style={{ background: '#1e222d', border: '1px solid #2962ff50', color: '#d1d4dc' }}
                autoCapitalize="characters"
              />
              <div className="text-[10px] mt-0.5" style={{ color: '#787b86' }}>
                Unique ID set by admin. User will login with this.
              </div>
            </div>

            {/* Name + Phone — optional */}
            <div className="grid grid-cols-2 gap-2">
              <input
                value={form.firstName}
                onChange={(e) => setForm((p) => ({ ...p, firstName: e.target.value }))}
                placeholder="Name (optional)"
                className="px-3 py-2 rounded text-sm"
                style={{ background: '#1e222d', border: '1px solid #363a45', color: '#d1d4dc' }}
              />
              <input
                value={form.phone}
                onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                placeholder="Phone (optional)"
                className="px-3 py-2 rounded text-sm"
                style={{ background: '#1e222d', border: '1px solid #363a45', color: '#d1d4dc' }}
              />
            </div>

            {/* Password — default TA1234 */}
            <div>
              <label className="text-xs mb-1 block" style={{ color: '#787b86' }}>Password</label>
              <input
                value={form.password}
                onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                placeholder="Default: TA1234"
                type="text"
                className="px-3 py-2 rounded text-sm font-mono"
                style={{ background: '#1e222d', border: '1px solid #363a45', color: '#d1d4dc' }}
              />
              <div className="text-[10px] mt-0.5" style={{ color: '#787b86' }}>
                Leave empty for default password TA1234. User will be asked to change on first login.
              </div>
            </div>

            {/* Account Type Checkboxes */}
            <div className="p-3 rounded-lg" style={{ background: '#1e222d', border: '1px solid #363a45' }}>
              <label className="text-xs mb-2 block font-medium" style={{ color: '#787b86' }}>
                Create Account Types
              </label>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.createDemo}
                    onChange={(e) => setForm((p) => ({ ...p, createDemo: e.target.checked }))}
                    className="w-4 h-4 rounded"
                    style={{ accentColor: '#f5c542' }}
                  />
                  <span className="text-sm font-medium" style={{ color: '#f5c542' }}>
                    Demo Account
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.createLive}
                    onChange={(e) => setForm((p) => ({ ...p, createLive: e.target.checked }))}
                    className="w-4 h-4 rounded"
                    style={{ accentColor: '#26a69a' }}
                  />
                  <span className="text-sm font-medium" style={{ color: '#26a69a' }}>
                    Live Account
                  </span>
                </label>
              </div>

              {!form.createDemo && !form.createLive && (
                <div className="mt-2 text-xs" style={{ color: '#ef5350' }}>
                  ⚠️ Please select at least one account type
                </div>
              )}
            </div>

            {/* ✅ FIX 6a: Liquidation Type (NEW) */}
            <div className="p-3 rounded-lg" style={{ background: '#1e222d', border: '1px solid #363a45' }}>
              <label className="text-xs mb-2 block font-medium" style={{ color: '#787b86' }}>
                Account Liquidation Mode
              </label>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="liquidationType"
                    value="liquidate"
                    checked={form.liquidationType === 'liquidate'}
                    onChange={(e) => setForm((p) => ({ ...p, liquidationType: e.target.value }))}
                    className="w-4 h-4"
                    style={{ accentColor: '#ef5350' }}
                  />
                  <div>
                    <span className="text-sm font-medium" style={{ color: '#ef5350' }}>Liquidate</span>
                    <div className="text-[10px]" style={{ color: '#787b86' }}>
                      Auto-close positions when margin level falls below stop-out level
                    </div>
                  </div>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="liquidationType"
                    value="illiquidate"
                    checked={form.liquidationType === 'illiquidate'}
                    onChange={(e) => setForm((p) => ({ ...p, liquidationType: e.target.value }))}
                    className="w-4 h-4"
                    style={{ accentColor: '#26a69a' }}
                  />
                  <div>
                    <span className="text-sm font-medium" style={{ color: '#26a69a' }}>Illiquidate</span>
                    <div className="text-[10px]" style={{ color: '#787b86' }}>
                      Positions continue trading even with low margin. No auto-close.
                    </div>
                  </div>
                </label>
              </div>
            </div>

            {/* Trading Settings */}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs mb-1 block" style={{ color: '#787b86' }}>Leverage</label>
                <select
                  value={form.leverage}
                  onChange={(e) => setForm((p) => ({ ...p, leverage: Number(e.target.value) }))}
                  className="w-full px-3 py-2 rounded text-sm"
                  style={{ background: '#1e222d', border: '1px solid #363a45', color: '#d1d4dc' }}
                >
                  {leverageOptions.map((lev) => (
                    <option key={lev} value={lev}>1:{lev}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs mb-1 block" style={{ color: '#787b86' }}>Brokerage (%)</label>
                <input
                  type="number"
                  value={form.brokerageRate}
                  onChange={(e) => setForm((p) => ({ ...p, brokerageRate: e.target.value }))}
                  placeholder="0.06"
                  step="0.01"
                  min="0"
                  className="w-full px-3 py-2 rounded text-sm"
                  style={{ background: '#1e222d', border: '1px solid #363a45', color: '#d1d4dc' }}
                />
                <div className="text-[10px] mt-0.5" style={{ color: '#787b86' }}>
                  Default: 0.06%
                </div>
              </div>

              <div>
                <label className="text-xs mb-1 block" style={{ color: '#787b86' }}>
                  Demo Balance {!form.createDemo && '(N/A)'}
                </label>
                <input
                  value={form.demoBalance}
                  onChange={(e) => setForm((p) => ({ ...p, demoBalance: e.target.value }))}
                  type="number"
                  disabled={!form.createDemo}
                  className="w-full px-3 py-2 rounded text-sm disabled:opacity-50"
                  style={{ background: '#1e222d', border: '1px solid #363a45', color: '#d1d4dc' }}
                />
              </div>
            </div>

            {/* Info about Login ID */}
            <div className="p-2 rounded text-xs" style={{ background: '#2962ff20', color: '#2962ff' }}>
              💡 User ID is set by you (admin). Default password is TA1234. User will be prompted to change password on first login.
            </div>

            <button
              onClick={createUser}
              disabled={!form.createDemo && !form.createLive}
              className="py-2.5 rounded font-semibold text-sm disabled:opacity-50"
              style={{ background: '#2962ff', color: '#fff' }}
            >
              Create User
            </button>
          </div>
        </div>

        {/* Users list */}
        <div className="text-sm font-semibold mb-2" style={{ color: '#d1d4dc' }}>
          Users ({users.length})
          {loading && <span className="ml-2 text-xs font-normal" style={{ color: '#787b86' }}>(Loading...)</span>}
        </div>

        <div className="space-y-2">
          {loading && users.length === 0 ? (
            <div className="text-center py-8" style={{ color: '#787b86' }}>Loading users...</div>
          ) : users.length === 0 ? (
            <div className="text-center py-8" style={{ color: '#787b86' }}>No users found</div>
          ) : (
            users.map((u) => {
              const isExpanded = expandedUserId === u.id;
              
              return (
                <div
                  key={u.id}
                  className="rounded-lg overflow-hidden"
                  style={{ background: '#2a2e39', border: '1px solid #363a45' }}
                >
                  {/* User header row */}
                  <div 
                    className="p-3 cursor-pointer hover:bg-white/5"
                    onClick={() => setExpandedUserId(isExpanded ? null : u.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            onClick={(e) => { e.stopPropagation(); copyLoginId(u.login_id); }}
                            className="flex items-center gap-1 px-2 py-1 rounded font-mono text-sm font-bold"
                            style={{ background: '#2962ff20', color: '#2962ff' }}
                            title="Click to copy"
                          >
                            {u.login_id || 'TA????'}
                            <Copy size={12} />
                          </button>
                          
                          <span 
                            className="px-2 py-0.5 rounded text-[10px] font-medium"
                            style={{ 
                              background: u.role === 'admin' ? '#2962ff20' : '#26a69a20',
                              color: u.role === 'admin' ? '#2962ff' : '#26a69a'
                            }}
                          >
                            {u.role || 'user'}
                          </span>
                          
                          {u.is_active ? (
                            <span className="text-[10px]" style={{ color: '#26a69a' }}>● Active</span>
                          ) : (
                            <span className="text-[10px]" style={{ color: '#ef5350' }}>● Inactive</span>
                          )}

                          {u.closing_mode && (
                            <span 
                              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium"
                              style={{ background: '#ff980020', color: '#ff9800' }}
                            >
                              <Lock size={10} />
                              Closing Mode
                            </span>
                          )}

                          {/* ✅ Show liquidation type badge */}
                          {u.liquidation_type && (
                            <span 
                              className="px-2 py-0.5 rounded text-[10px] font-medium"
                              style={{ 
                                background: u.liquidation_type === 'illiquidate' ? '#26a69a20' : '#ef535020',
                                color: u.liquidation_type === 'illiquidate' ? '#26a69a' : '#ef5350'
                              }}
                            >
                              {u.liquidation_type === 'illiquidate' ? 'Illiquidate' : 'Liquidate'}
                            </span>
                          )}
                        </div>
                        
                        <div className="text-xs mt-1" style={{ color: '#787b86' }}>
                          {u.first_name} {u.last_name} • {u.email}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleClosingMode(u); }}
                          className="p-2 rounded"
                          style={{ 
                            background: u.closing_mode ? '#ff980030' : '#1e222d',
                            border: '1px solid #363a45'
                          }}
                          title={u.closing_mode ? 'Disable Closing Mode' : 'Enable Closing Mode'}
                        >
                          {u.closing_mode ? (
                            <Lock size={16} color="#ff9800" />
                          ) : (
                            <Unlock size={16} color="#787b86" />
                          )}
                        </button>

                        <button
                          onClick={(e) => { e.stopPropagation(); toggleActive(u); }}
                          className="px-3 py-1.5 rounded text-xs font-medium"
                          style={{ 
                            background: u.is_active ? '#ef535020' : '#26a69a20', 
                            color: u.is_active ? '#ef5350' : '#26a69a' 
                          }}
                        >
                          {u.is_active ? 'Deactivate' : 'Activate'}
                        </button>

                        {isExpanded ? (
                          <ChevronUp size={18} color="#787b86" />
                        ) : (
                          <ChevronDown size={18} color="#787b86" />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Expanded section */}
                  {isExpanded && (
                    <div 
                      className="p-3 border-t"
                      style={{ borderColor: '#363a45', background: '#252832' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Settings size={14} color="#787b86" />
                          <span className="text-xs font-semibold" style={{ color: '#787b86' }}>
                            Account Settings
                          </span>
                        </div>
                        {/* Delete User Button */}
                        <button
                          onClick={() => deleteUser(u)}
                          className="px-3 py-1.5 rounded text-xs font-medium flex items-center gap-1"
                          style={{ background: '#ef535020', color: '#ef5350', border: '1px solid #ef535050' }}
                        >
                          <Trash2 size={14} />
                          Delete User
                        </button>
                      </div>

                      {/* User Settings */}
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        {/* Brokerage Rate — manual input */}
                        <div className="p-2 rounded" style={{ background: '#1e222d' }}>
                          <label className="text-xs block mb-1" style={{ color: '#787b86' }}>Brokerage Rate (%)</label>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              defaultValue={((u.brokerage_rate || 0.0003) * 100).toFixed(4)}
                              step="0.01"
                              min="0"
                              onBlur={(e) => {
                                const pct = parseFloat(e.target.value);
                                if (!isNaN(pct) && pct >= 0) {
                                  updateBrokerageRate(u.id, pct / 100);
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  const pct = parseFloat(e.target.value);
                                  if (!isNaN(pct) && pct >= 0) {
                                    updateBrokerageRate(u.id, pct / 100);
                                  }
                                }
                              }}
                              className="w-full px-2 py-1 rounded text-xs"
                              style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#d1d4dc' }}
                            />
                            <span className="text-xs" style={{ color: '#787b86' }}>%</span>
                          </div>
                        </div>

                        {/* Reset Password */}
                        <div className="p-2 rounded flex items-end" style={{ background: '#1e222d' }}>
                          <button
                            onClick={() => resetPassword(u)}
                            className="w-full px-3 py-1.5 rounded text-xs font-medium"
                            style={{ background: '#363a45', color: '#d1d4dc' }}
                          >
                            Reset Password
                          </button>
                        </div>
                      </div>

                      {/* Individual Accounts */}
                      {u.accounts && u.accounts.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-xs font-medium" style={{ color: '#d1d4dc' }}>
                            Trading Accounts:
                          </div>
                          
                          {u.accounts.map((acc) => (
                            <div 
                              key={acc.id}
                              className="p-2 rounded"
                              style={{ background: '#1e222d' }}
                            >
                              <div className="flex flex-col gap-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs font-medium" style={{ color: '#d1d4dc' }}>
                                      {acc.account_number}
                                    </span>
                                    <span 
                                      className="px-1.5 py-0.5 rounded text-[10px]"
                                      style={{ 
                                        background: acc.is_demo ? '#f5c54220' : '#26a69a20',
                                        color: acc.is_demo ? '#f5c542' : '#26a69a'
                                      }}
                                    >
                                      {acc.is_demo ? 'DEMO' : 'LIVE'}
                                    </span>
                                    <span
                                      className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                                      style={{ background: '#2962ff20', color: '#2962ff' }}
                                    >
                                      1:{acc.leverage || 5}
                                    </span>
                                  </div>

                                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2 text-[10px]">
                                    <div style={{ color: '#787b86' }}>
                                      Balance:{' '}
                                      <span style={{ color: '#d1d4dc' }}>
                                        {parseFloat(acc.balance || 0).toLocaleString('en-IN')}
                                      </span>
                                    </div>
                                    <div style={{ color: '#787b86' }}>
                                      Equity:{' '}
                                      <span style={{ color: '#d1d4dc' }}>
                                        {parseFloat(acc.equity || 0).toLocaleString('en-IN')}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                <div className="flex flex-wrap gap-2">
                                  <button
                                    onClick={() => setAddMoneyModal({ user: u, account: acc, mode: 'add' })}
                                    className="px-2.5 py-1.5 rounded text-[10px] font-medium flex items-center gap-1"
                                    style={{ 
                                      background: '#26a69a20', 
                                      border: '1px solid #26a69a50', 
                                      color: '#26a69a' 
                                    }}
                                    title="Add money to this account"
                                  >
                                    <Plus size={12} />
                                    Add
                                  </button>
                                  <button
                                    onClick={() => setAddMoneyModal({ user: u, account: acc, mode: 'reduce' })}
                                    className="px-2.5 py-1.5 rounded text-[10px] font-medium flex items-center gap-1"
                                    style={{ 
                                      background: '#ef535020', 
                                      border: '1px solid #ef535050', 
                                      color: '#ef5350' 
                                    }}
                                    title="Reduce money from this account"
                                  >
                                    <Trash2 size={12} />
                                    Reduce
                                  </button>
                                  <button
                                    onClick={() => openEquityModal(u, acc)}
                                    className="px-2.5 py-1.5 rounded text-[10px] font-medium flex items-center gap-1"
                                    style={{
                                      background: '#f5c54220',
                                      border: '1px solid #f5c54250',
                                      color: '#f5c542',
                                    }}
                                    title="Edit equity"
                                  >
                                    <Wallet size={12} />
                                    Equity
                                  </button>
                                  <button
                                    onClick={() => openLeverageModal(u, acc)}
                                    className="px-2.5 py-1.5 rounded text-[10px] font-medium flex items-center gap-1"
                                    style={{
                                      background: '#2962ff20',
                                      border: '1px solid #2962ff50',
                                      color: '#2962ff',
                                    }}
                                    title="Set leverage"
                                  >
                                    <Settings size={12} />
                                    Lvrg
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ✅ FIX 5: INLINE Add Money Modal — NOT a <Component />.
          This prevents React from re-mounting on every parent render,
          which was causing the input to lose focus after each keystroke
          (only allowing single digit entry). */}
      {addMoneyModal && (() => {
        const { user: mUser, account: mAccount, mode = 'add' } = addMoneyModal;
        const isReduce = mode === 'reduce';
        const currentBalance = parseFloat(mAccount.balance || 0);

        return (
          <div 
            className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
            onClick={() => setAddMoneyModal(null)}
          >
            <div 
              className="w-full max-w-sm rounded-xl"
              style={{ background: '#1e222d', border: '1px solid #363a45' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: '#363a45' }}>
                <div className="flex items-center gap-2">
                  <Wallet size={20} color={isReduce ? '#ef5350' : '#26a69a'} />
                  <h3 className="font-bold text-lg" style={{ color: '#d1d4dc' }}>
                    {isReduce ? 'Reduce Money' : 'Add Money'}
                  </h3>
                </div>
                <button onClick={() => setAddMoneyModal(null)}>
                  <X size={22} color="#787b86" />
                </button>
              </div>

              <div className="p-4 space-y-4">
                <div className="p-3 rounded-lg" style={{ background: '#2a2e39' }}>
                  <div className="text-sm" style={{ color: '#787b86' }}>User</div>
                  <div className="font-bold" style={{ color: '#d1d4dc' }}>
                    {mUser.login_id || 'N/A'} - {mUser.first_name} {mUser.last_name}
                  </div>
                  <div className="text-xs mt-1" style={{ color: '#787b86' }}>{mUser.email}</div>
                  
                  <div className="mt-3 pt-3 border-t" style={{ borderColor: '#363a45' }}>
                    <div className="text-sm" style={{ color: '#787b86' }}>Account</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="font-bold" style={{ color: '#d1d4dc' }}>{mAccount.account_number}</span>
                      <span 
                        className="px-2 py-0.5 rounded text-xs"
                        style={{ 
                          background: mAccount.is_demo ? '#f5c54220' : '#26a69a20',
                          color: mAccount.is_demo ? '#f5c542' : '#26a69a'
                        }}
                      >
                        {mAccount.is_demo ? 'DEMO' : 'LIVE'}
                      </span>
                    </div>
                    <div className="text-sm mt-1" style={{ color: '#787b86' }}>
                      Current Balance: <span style={{ color: '#26a69a' }}>{currentBalance.toLocaleString('en-IN')}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm mb-2" style={{ color: '#787b86' }}>
                    Amount to {isReduce ? 'Reduce' : 'Add'}
                  </label>
                  {/* ✅ FIX 5: Changed type="number" to type="text" with inputMode="decimal"
                      and manual filtering. This prevents mobile keyboard issues and ensures
                      the input doesn't lose focus after each keystroke. */}
                  <input
                    type="text"
                    inputMode="decimal"
                    value={addMoneyAmount}
                    onChange={(e) => {
                      // Only allow digits and a single decimal point
                      const val = e.target.value.replace(/[^0-9.]/g, '');
                      // Prevent multiple decimal points
                      const parts = val.split('.');
                      const sanitized = parts.length > 2 
                        ? parts[0] + '.' + parts.slice(1).join('') 
                        : val;
                      setAddMoneyAmount(sanitized);
                    }}
                    onFocus={(e) => e.target.select()}
                    placeholder="Enter amount"
                    className="w-full px-4 py-3 rounded-lg text-lg font-bold text-center"
                    style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#d1d4dc' }}
                    autoFocus
                  />
                  {isReduce && Number(addMoneyAmount) > currentBalance && (
                    <div className="text-xs mt-1" style={{ color: '#ef5350' }}>
                      ⚠️ Amount exceeds current balance ({currentBalance.toLocaleString('en-IN')})
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-4 gap-2">
                  {[1000, 5000, 10000, 50000].map((amt) => (
                    <button
                      key={amt}
                      onClick={() => setAddMoneyAmount(String(amt))}
                      className="py-2 rounded-lg text-xs font-medium"
                      style={{
                        background: Number(addMoneyAmount) === amt ? (isReduce ? '#ef5350' : '#26a69a') : '#2a2e39',
                        color: Number(addMoneyAmount) === amt ? '#fff' : '#787b86',
                        border: '1px solid #363a45',
                      }}
                    >
                      {(amt / 1000)}K
                    </button>
                  ))}
                </div>

                <div>
                  <label className="block text-sm mb-2" style={{ color: '#787b86' }}>Note (Optional)</label>
                  <input
                    type="text"
                    value={addMoneyNote}
                    onChange={(e) => setAddMoneyNote(e.target.value)}
                    placeholder={isReduce ? 'e.g., Adjustment, correction' : 'e.g., Cash received at office'}
                    className="w-full px-4 py-2.5 rounded-lg text-sm"
                    style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#d1d4dc' }}
                  />
                </div>

                {addMoneyAmount && Number(addMoneyAmount) > 0 && (
                  <div className="p-3 rounded-lg" style={{ 
                    background: isReduce ? '#ef535020' : '#26a69a20', 
                    border: `1px solid ${isReduce ? '#ef535050' : '#26a69a50'}` 
                  }}>
                    <div className="flex justify-between text-sm">
                      <span style={{ color: '#787b86' }}>Current Balance</span>
                      <span style={{ color: '#d1d4dc' }}>{currentBalance.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="flex justify-between text-sm mt-1">
                      <span style={{ color: '#787b86' }}>{isReduce ? 'Reducing' : 'Adding'}</span>
                      <span style={{ color: isReduce ? '#ef5350' : '#26a69a' }}>
                        {isReduce ? '-' : '+'}{Number(addMoneyAmount).toLocaleString('en-IN')}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm mt-2 pt-2 border-t" style={{ borderColor: isReduce ? '#ef535050' : '#26a69a50' }}>
                      <span className="font-medium" style={{ color: '#d1d4dc' }}>New Balance</span>
                      <span className="font-bold" style={{ color: isReduce ? '#ef5350' : '#26a69a' }}>
                        {(isReduce 
                          ? Math.max(0, currentBalance - Number(addMoneyAmount))
                          : currentBalance + Number(addMoneyAmount)
                        ).toLocaleString('en-IN')}
                      </span>
                    </div>
                  </div>
                )}

                <button
                  onClick={handleAddMoney}
                  disabled={addMoneyLoading || !addMoneyAmount || Number(addMoneyAmount) <= 0 || (isReduce && Number(addMoneyAmount) > currentBalance)}
                  className="w-full py-3.5 rounded-lg font-semibold text-base disabled:opacity-50 flex items-center justify-center gap-2"
                  style={{ background: isReduce ? '#ef5350' : '#26a69a', color: '#fff' }}
                >
                  {addMoneyLoading ? 'Processing...' : (
                    <>
                      {isReduce ? <Trash2 size={20} /> : <Plus size={20} />}
                      {isReduce ? 'Reduce' : 'Add'} {Number(addMoneyAmount || 0).toLocaleString('en-IN')} {isReduce ? 'from' : 'to'} Account
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {equityModal && (() => {
        const { user: mUser, account: mAccount } = equityModal;

        return (
          <div
            className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
            onClick={() => setEquityModal(null)}
          >
            <div
              className="w-full max-w-sm rounded-xl"
              style={{ background: '#1e222d', border: '1px solid #363a45' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: '#363a45' }}>
                <div className="flex items-center gap-2">
                  <Wallet size={20} color="#f5c542" />
                  <h3 className="font-bold text-lg" style={{ color: '#d1d4dc' }}>
                    Edit Equity
                  </h3>
                </div>
                <button onClick={() => setEquityModal(null)}>
                  <X size={22} color="#787b86" />
                </button>
              </div>

              <div className="p-4 space-y-4">
                <div className="p-3 rounded-lg" style={{ background: '#2a2e39' }}>
                  <div className="text-sm" style={{ color: '#787b86' }}>User</div>
                  <div className="font-bold" style={{ color: '#d1d4dc' }}>
                    {mUser.login_id || 'N/A'} - {mUser.first_name} {mUser.last_name}
                  </div>
                  <div className="text-xs mt-1" style={{ color: '#787b86' }}>
                    Account {mAccount.account_number}
                  </div>
                  <div className="text-sm mt-3" style={{ color: '#787b86' }}>
                    Current Equity:{' '}
                    <span style={{ color: '#f5c542' }}>
                      {Number(mAccount.equity || 0).toLocaleString('en-IN')}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-sm mb-2" style={{ color: '#787b86' }}>
                    New Equity
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={equityAmount}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9.-]/g, '');
                      const parts = val.split('.');
                      const sanitized = parts.length > 2
                        ? parts[0] + '.' + parts.slice(1).join('')
                        : val;
                      setEquityAmount(sanitized);
                    }}
                    className="w-full px-4 py-3 rounded-lg text-lg font-bold text-center"
                    style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#d1d4dc' }}
                    autoFocus
                  />
                </div>

                <div className="text-xs leading-5" style={{ color: '#787b86' }}>
                  This updates the account equity snapshot for this user account.
                </div>

                <button
                  onClick={handleUpdateEquity}
                  disabled={equityLoading || equityAmount === '' || Number.isNaN(Number(equityAmount))}
                  className="w-full py-3.5 rounded-lg font-semibold text-base disabled:opacity-50"
                  style={{ background: '#f5c542', color: '#111827' }}
                >
                  {equityLoading ? 'Updating...' : 'Update Equity'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {leverageModal && (() => {
        const { user: mUser, account: mAccount } = leverageModal;

        return (
          <div
            className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
            onClick={() => setLeverageModal(null)}
          >
            <div
              className="w-full max-w-sm rounded-xl"
              style={{ background: '#1e222d', border: '1px solid #363a45' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: '#363a45' }}>
                <div className="flex items-center gap-2">
                  <Settings size={20} color="#2962ff" />
                  <h3 className="font-bold text-lg" style={{ color: '#d1d4dc' }}>
                    Set Leverage
                  </h3>
                </div>
                <button onClick={() => setLeverageModal(null)}>
                  <X size={22} color="#787b86" />
                </button>
              </div>

              <div className="p-4 space-y-4">
                <div className="p-3 rounded-lg" style={{ background: '#2a2e39' }}>
                  <div className="text-sm" style={{ color: '#787b86' }}>User</div>
                  <div className="font-bold" style={{ color: '#d1d4dc' }}>
                    {mUser.login_id || 'N/A'} - {mUser.first_name} {mUser.last_name}
                  </div>
                  <div className="text-xs mt-1" style={{ color: '#787b86' }}>
                    Account {mAccount.account_number}
                  </div>
                </div>

                <div>
                  <label className="block text-sm mb-2" style={{ color: '#787b86' }}>
                    Select Leverage
                  </label>
                  <select
                    value={selectedLeverage}
                    onChange={(e) => setSelectedLeverage(Number(e.target.value))}
                    className="w-full px-4 py-3 rounded-lg text-base font-semibold"
                    style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#2962ff' }}
                  >
                    {leverageOptions.map((lev) => (
                      <option key={lev} value={lev}>1:{lev}</option>
                    ))}
                  </select>
                </div>

                <button
                  onClick={handleUpdateLeverage}
                  className="w-full py-3.5 rounded-lg font-semibold text-base"
                  style={{ background: '#2962ff', color: '#fff' }}
                >
                  Update to 1:{selectedLeverage}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
