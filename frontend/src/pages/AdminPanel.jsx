// frontend/src/pages/AdminPanel.jsx  ── FIXED VERSION (adds Symbol Ban tab)
import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Calendar, Edit3, Lock, RefreshCw, Search, Trash2 } from 'lucide-react';
import AdminUsers      from '../components/admin/AdminUsers';
import AdminWithdrawals from '../components/admin/AdminWithdrawals';
import AdminKiteSetup  from '../components/admin/AdminKiteSetup';
import AdminQrDeposits from '../components/admin/AdminQrDeposits';
import AdminSymbolBan  from '../components/admin/AdminSymbolBan';   // ← NEW
import api from '../services/api';

export default function AdminPanel() {
  const [adminView, setAdminView] = useState('users');

  const [holidayStatus, setHolidayStatus] = useState({
    isHoliday: false, message: '', date: null, marketOpen: true,
  });
  const [holidayMessage, setHolidayMessage] = useState('');
  const [holidayDate,    setHolidayDate]    = useState('');
  const [holidaySegments, setHolidaySegments] = useState({ nseBseClosed: true, mcxClosed: true, mcxMorningOnly: false });
  const [holidayLoading, setHolidayLoading] = useState(false);
  const [settlementStatus, setSettlementStatus] = useState({
    lastRun: null, nextScheduled: null, timezone: 'Asia/Kolkata',
  });
  const [settlementLoading, setSettlementLoading] = useState(false);
  const [settlementTriggering, setSettlementTriggering] = useState(false);
  const [settlementMode, setSettlementMode] = useState('all');
  const [settlementSingleUserId, setSettlementSingleUserId] = useState('');
  const [settlementUserIds, setSettlementUserIds] = useState([]);
  const [settlementEditUserId, setSettlementEditUserId] = useState('');
  const [settlementEditAccountId, setSettlementEditAccountId] = useState('');
  const [settlementEditDate, setSettlementEditDate] = useState('');
  const [settlementEditAmount, setSettlementEditAmount] = useState('');
  const [settlementEditLoading, setSettlementEditLoading] = useState(false);

  const [manualTradeId, setManualTradeId]   = useState('');
  const [manualPrice,   setManualPrice]     = useState('');
  const [manualReason,  setManualReason]    = useState('');
  const [manualLoading, setManualLoading]   = useState(false);
  const [positionEdit, setPositionEdit]     = useState({
    quantity: '',
    openPrice: '',
    currentPrice: '',
    stopLoss: '',
    takeProfit: '',
    comment: '',
  });
  const [positionEditLoading, setPositionEditLoading] = useState(false);
  const [positionDeleteLoading, setPositionDeleteLoading] = useState(false);

  const [adminUsers,                    setAdminUsers]                    = useState([]);
  const [selectedUserId,                setSelectedUserId]                = useState('');
  const [selectedUserPositions,         setSelectedUserPositions]         = useState([]);
  const [loadingSelectedUserPositions,  setLoadingSelectedUserPositions]  = useState(false);
  const [closeAllLoading,               setCloseAllLoading]               = useState(false);
  const [positionSearch,                setPositionSearch]                = useState('');

  useEffect(() => {
    fetchHolidayStatus();
    fetchAdminUsers();
    fetchSettlementStatus();
  }, []);

  useEffect(() => {
    if (selectedUserId) fetchSelectedUserPositions(selectedUserId);
    else { setSelectedUserPositions([]); setManualTradeId(''); setPositionSearch(''); }
  }, [selectedUserId]);

  const selectedManualPosition = (selectedUserPositions || []).find((p) => p.id === manualTradeId) || null;

  useEffect(() => {
    if (!selectedManualPosition) {
      setPositionEdit({
        quantity: '',
        openPrice: '',
        currentPrice: '',
        stopLoss: '',
        takeProfit: '',
        comment: '',
      });
      return;
    }

    setPositionEdit({
      quantity: String(selectedManualPosition.quantity ?? ''),
      openPrice: String(selectedManualPosition.open_price ?? ''),
      currentPrice: String(selectedManualPosition.current_price ?? selectedManualPosition.open_price ?? ''),
      stopLoss: String(selectedManualPosition.stop_loss ?? ''),
      takeProfit: String(selectedManualPosition.take_profit ?? ''),
      comment: String(selectedManualPosition.comment || ''),
    });
  }, [selectedManualPosition]);

  const fetchHolidayStatus = async () => {
    try {
      const res = await api.get('/admin/market-holiday');
      if (res.data?.success) {
        setHolidayStatus(res.data.data || {});
        setHolidayMessage(res.data.data?.message || '');
        setHolidayDate(res.data.data?.date || '');
        setHolidaySegments({
          nseBseClosed: res.data.data?.segments?.nseBseClosed !== false,
          mcxClosed: res.data.data?.segments?.mcxClosed !== false,
          mcxMorningOnly: !!res.data.data?.segments?.mcxMorningOnly,
        });
      }
    } catch (e) { console.error(e); }
  };

  const fetchAdminUsers = async () => {
    try {
      const res = await api.get('/admin/users?limit=500');
      if (res.data?.success) setAdminUsers(res.data.data || []);
    } catch (e) { console.error(e); toast.error('Failed to fetch users'); }
  };

  const fetchSettlementStatus = async () => {
    setSettlementLoading(true);
    try {
      const res = await api.get('/admin/settlement-status');
      if (res.data?.success) {
        setSettlementStatus({
          lastRun: res.data.lastRun || null,
          nextScheduled: res.data.nextScheduled || null,
          timezone: res.data.timezone || 'Asia/Kolkata',
          cronExpression: res.data.cronExpression || '',
        });
      }
    } catch (e) {
      console.error(e);
      toast.error(e.response?.data?.message || 'Failed to load settlement status');
    } finally {
      setSettlementLoading(false);
    }
  };

  const triggerSettlement = async () => {
    const userIds = settlementMode === 'all'
      ? []
      : settlementMode === 'single'
        ? [settlementSingleUserId].filter(Boolean)
        : settlementUserIds.filter(Boolean);

    if (settlementMode !== 'all' && userIds.length === 0) {
      toast.error('Select at least one user for settlement');
      return;
    }

    const scopeText = settlementMode === 'all'
      ? 'all users'
      : `${userIds.length} selected user${userIds.length === 1 ? '' : 's'}`;

    if (!window.confirm(`Run weekly settlement manually for ${scopeText}? This will close and reopen selected open positions at the current settlement price.`)) return;

    setSettlementTriggering(true);
    try {
      const res = await api.post('/admin/trigger-settlement', { confirm: true, userIds });
      if (res.data?.success) {
        toast.success(
          typeof res.data.settled === 'number'
            ? `Settlement complete: ${res.data.settled} trade(s) settled`
            : 'Settlement completed successfully'
        );
        await fetchSettlementStatus();
      } else {
        toast.error(res.data?.message || 'Settlement failed');
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Settlement failed');
    } finally {
      setSettlementTriggering(false);
    }
  };

  const selectSettlementEditUser = (userId) => {
    const user = adminUsers.find((row) => row.id === userId);
    const account = user?.accounts?.[0];
    setSettlementEditUserId(userId);
    setSettlementEditAccountId(account?.id || '');
  };

  const updateSettlementBalance = async () => {
    const amount = Number(settlementEditAmount);
    if (!settlementEditUserId || !settlementEditAccountId) {
      toast.error('Select a user and account');
      return;
    }
    if (!Number.isFinite(amount)) {
      toast.error('Enter a valid balance settled value');
      return;
    }

    if (!window.confirm(`Update balance settled to ${amount.toFixed(2)}?`)) return;

    setSettlementEditLoading(true);
    try {
      const res = await api.post('/admin/settlement-balance', {
        accountId: settlementEditAccountId,
        settlementDate: settlementEditDate || undefined,
        amount,
      });
      if (res.data?.success) {
        toast.success(res.data.message || 'Balance settled updated');
        await fetchAdminUsers();
      } else {
        toast.error(res.data?.message || 'Update failed');
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Update failed');
    } finally {
      setSettlementEditLoading(false);
    }
  };

  const fetchSelectedUserPositions = async (userId) => {
    if (!userId) return;
    setLoadingSelectedUserPositions(true);
    try {
      const res = await api.get(`/admin/users/${userId}/open-positions`);
      if (res.data?.success) setSelectedUserPositions(res.data.data || []);
      else toast.error(res.data?.message || 'Failed to fetch user positions');
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to fetch user positions');
    } finally { setLoadingSelectedUserPositions(false); }
  };

  const toggleHoliday = async (enable) => {
    setHolidayLoading(true);
    try {
      const res = await api.post('/admin/market-holiday', {
        isHoliday: enable, message: enable ? holidayMessage : '', date: enable ? holidayDate || null : null, segments: holidaySegments,
      });
      if (res.data?.success) {
        setHolidayStatus({ ...(res.data.data || {}), isHoliday: enable, message: enable ? holidayMessage : '', date: enable ? holidayDate || null : null });
        toast.success(res.data.message || 'Market holiday updated');
        if (!enable) { setHolidayMessage(''); setHolidayDate(''); }
      } else toast.error(res.data?.message || 'Failed to update');
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to update market holiday');
    } finally { setHolidayLoading(false); }
  };

  const handleManualClose = async () => {
    if (!manualTradeId.trim()) return toast.error('Please select a position first');
    setManualLoading(true);
    try {
      const res = await api.post('/admin/close-position', {
        tradeId:    manualTradeId.trim(),
        closePrice: manualPrice ? Number(manualPrice) : undefined,
        reason:     manualReason || 'Admin manual close',
      });
      if (res.data?.success) {
        toast.success(res.data.message || 'Position closed');
        setManualTradeId(''); setManualPrice(''); setManualReason('');
        if (selectedUserId) await fetchSelectedUserPositions(selectedUserId);
      } else toast.error(res.data?.message || 'Manual close failed');
    } catch (e) {
      toast.error(e.response?.data?.message || 'Manual close failed');
    } finally { setManualLoading(false); }
  };

  const handleUpdateSelectedPosition = async () => {
    if (!manualTradeId.trim()) return toast.error('Please select a position first');

    setPositionEditLoading(true);
    try {
      const res = await api.patch(`/admin/positions/${manualTradeId.trim()}`, {
        quantity: positionEdit.quantity,
        openPrice: positionEdit.openPrice,
        currentPrice: positionEdit.currentPrice,
        stopLoss: positionEdit.stopLoss,
        takeProfit: positionEdit.takeProfit,
        comment: positionEdit.comment,
      });

      if (res.data?.success) {
        toast.success(res.data.message || 'Position updated');
        if (selectedUserId) await fetchSelectedUserPositions(selectedUserId);
      } else {
        toast.error(res.data?.message || 'Failed to update position');
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to update position');
    } finally {
      setPositionEditLoading(false);
    }
  };

  const handleDeleteSelectedPosition = async () => {
    if (!manualTradeId.trim()) return toast.error('Please select a position first');
    if (!window.confirm('Delete the selected open position? This will remove it completely.')) return;

    setPositionDeleteLoading(true);
    try {
      const res = await api.delete(`/admin/positions/${manualTradeId.trim()}`);
      if (res.data?.success) {
        toast.success(res.data.message || 'Position deleted');
        setManualTradeId('');
        setManualPrice('');
        setManualReason('');
        if (selectedUserId) await fetchSelectedUserPositions(selectedUserId);
      } else {
        toast.error(res.data?.message || 'Failed to delete position');
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to delete position');
    } finally {
      setPositionDeleteLoading(false);
    }
  };

  const handleCloseAllSelectedUserPositions = async () => {
    if (!selectedUserId) return toast.error('Please select a user');
    if (!window.confirm('Close ALL open positions of selected user?')) return;
    setCloseAllLoading(true);
    try {
      const res = await api.post('/admin/users/close-all-positions', {
        userId:     selectedUserId,
        closePrice: manualPrice ? Number(manualPrice) : undefined,
        reason:     manualReason || 'Admin close all selected user positions',
      });
      if (res.data?.success) {
        toast.success(res.data.message || 'All positions closed');
        setManualTradeId(''); setManualPrice(''); setManualReason('');
        await fetchSelectedUserPositions(selectedUserId);
      } else toast.error(res.data?.message || 'Failed to close all positions');
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to close all positions');
    } finally { setCloseAllLoading(false); }
  };

  const filteredSelectedUserPositions = (selectedUserPositions || []).filter((p) => {
    const term = positionSearch.trim().toLowerCase();
    if (!term) return true;
    return (
      String(p.symbol || '').toLowerCase().includes(term) ||
      String(p.id     || '').toLowerCase().includes(term) ||
      String(p.user_login_id || '').toLowerCase().includes(term)
    );
  });
  const settlementEditUser = adminUsers.find((row) => row.id === settlementEditUserId);
  const settlementEditAccounts = settlementEditUser?.accounts || [];

  // ── Tabs — includes new Script Ban tab ──────────────────────────────────
  const tabs = [
    { id: 'users',       label: 'Users' },
    { id: 'withdrawals', label: 'Withdrawals' },
    { id: 'qrDeposits',  label: 'QR Deposits' },
    { id: 'settlement',  label: 'Settlement' },
    { id: 'market',      label: 'Market Holiday' },
    { id: 'manualClose', label: 'Manual Close' },
    { id: 'symbolBan',   label: '🚫 Script Ban' },   // ← NEW
    { id: 'kite',        label: '🔌 Kite Setup' },
  ];

  return (
    <div className="flex flex-col h-full" style={{ background: '#1e222d' }}>
      {/* Tab bar */}
      <div className="flex border-b overflow-x-auto" style={{ borderColor: '#363a45' }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setAdminView(tab.id)}
            className="flex-1 py-3 text-sm font-medium border-b-2 whitespace-nowrap px-4"
            style={{
              color:       adminView === tab.id ? '#2962ff' : '#787b86',
              borderColor: adminView === tab.id ? '#2962ff' : 'transparent',
              minWidth: '120px',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {adminView === 'users'       && <AdminUsers />}
        {adminView === 'withdrawals' && <AdminWithdrawals />}
        {adminView === 'qrDeposits'  && <AdminQrDeposits />}
        {adminView === 'kite'        && <AdminKiteSetup />}
        {adminView === 'symbolBan'   && <AdminSymbolBan />}   {/* ← NEW */}

        {adminView === 'settlement' && (
          <div className="p-4 max-w-lg mx-auto">
            <div className="p-4 rounded-xl" style={{ background: '#2a2e39', border: '1px solid #363a45' }}>
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                  <Calendar size={20} color="#2962ff" />
                  <h3 className="font-bold text-lg" style={{ color: '#d1d4dc' }}>Weekly Settlement</h3>
                </div>
                <button
                  onClick={fetchSettlementStatus}
                  disabled={settlementLoading}
                  className="p-2 rounded-lg disabled:opacity-50"
                  style={{ background: '#1e222d', border: '1px solid #363a45', color: '#d1d4dc' }}
                  title="Refresh settlement status"
                >
                  <RefreshCw size={16} className={settlementLoading ? 'animate-spin' : ''} />
                </button>
              </div>

              <div className="p-3 rounded-lg mb-4" style={{ background: '#1e222d', border: '1px solid #363a45' }}>
                <div className="text-xs mb-2" style={{ color: '#787b86' }}>Status</div>
                <div className="grid grid-cols-1 gap-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <span style={{ color: '#787b86' }}>Last run</span>
                    <span style={{ color: '#d1d4dc', textAlign: 'right' }}>
                      {settlementStatus.lastRun ? new Date(settlementStatus.lastRun).toLocaleString() : 'Never'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span style={{ color: '#787b86' }}>Next scheduled</span>
                    <span style={{ color: '#d1d4dc', textAlign: 'right' }}>
                      {settlementStatus.nextScheduled ? new Date(settlementStatus.nextScheduled).toLocaleString() : 'Not available'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span style={{ color: '#787b86' }}>Timezone</span>
                    <span style={{ color: '#d1d4dc', textAlign: 'right' }}>
                      {settlementStatus.timezone || 'Asia/Kolkata'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-lg mb-4" style={{ background: '#2962ff15', border: '1px solid #2962ff40' }}>
                <div className="text-sm font-medium mb-1" style={{ color: '#d1d4dc' }}>Manual fallback</div>
                <div className="text-xs" style={{ color: '#9ca3af' }}>
                  Use this when the automatic weekly settlement does not run on time.
                </div>
              </div>

              <div className="p-3 rounded-lg mb-4" style={{ background: '#1e222d', border: '1px solid #363a45' }}>
                <label className="block text-xs font-semibold mb-2" style={{ color: '#9ca3af' }}>
                  Settlement scope
                </label>
                <select
                  value={settlementMode}
                  onChange={(e) => {
                    setSettlementMode(e.target.value);
                    setSettlementSingleUserId('');
                    setSettlementUserIds([]);
                  }}
                  className="w-full px-3 py-2 rounded-lg mb-3"
                  style={{ background: '#131722', color: '#d1d4dc', border: '1px solid #363a45' }}
                >
                  <option value="all">All users</option>
                  <option value="single">Select one user</option>
                  <option value="multiple">Select multiple users</option>
                </select>

                {settlementMode === 'single' && (
                  <select
                    value={settlementSingleUserId}
                    onChange={(e) => setSettlementSingleUserId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg"
                    style={{ background: '#131722', color: '#d1d4dc', border: '1px solid #363a45' }}
                  >
                    <option value="">Select user</option>
                    {adminUsers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.login_id || user.email || user.id} - {[user.first_name, user.last_name].filter(Boolean).join(' ')}
                      </option>
                    ))}
                  </select>
                )}

                {settlementMode === 'multiple' && (
                  <div className="max-h-52 overflow-auto rounded-lg" style={{ border: '1px solid #363a45' }}>
                    {adminUsers.map((user) => {
                      const checked = settlementUserIds.includes(user.id);
                      return (
                        <label
                          key={user.id}
                          className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer"
                          style={{ color: '#d1d4dc', borderBottom: '1px solid #2a2e39' }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setSettlementUserIds((prev) => (
                                e.target.checked
                                  ? [...new Set([...prev, user.id])]
                                  : prev.filter((id) => id !== user.id)
                              ));
                            }}
                          />
                          <span>
                            {user.login_id || user.email || user.id}
                            <span style={{ color: '#787b86' }}>
                              {' '} {[user.first_name, user.last_name].filter(Boolean).join(' ')}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <button
                onClick={triggerSettlement}
                disabled={settlementTriggering}
                className="w-full py-3 rounded-lg font-semibold text-white disabled:opacity-50"
                style={{ background: '#2962ff' }}
              >
                {settlementTriggering ? 'Running Settlement...' : 'Run Settlement Now'}
              </button>

              <div className="p-3 rounded-lg mt-4" style={{ background: '#1e222d', border: '1px solid #363a45' }}>
                <div className="text-sm font-semibold mb-1" style={{ color: '#d1d4dc' }}>Edit Balance Settled</div>
                <div className="text-xs mb-3" style={{ color: '#9ca3af' }}>
                  Correct the latest settlement value shown in History. Date is optional.
                </div>
                <select
                  value={settlementEditUserId}
                  onChange={(e) => selectSettlementEditUser(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg mb-2"
                  style={{ background: '#131722', color: '#d1d4dc', border: '1px solid #363a45' }}
                >
                  <option value="">Select user</option>
                  {adminUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.login_id || user.email || user.id} - {[user.first_name, user.last_name].filter(Boolean).join(' ')}
                    </option>
                  ))}
                </select>
                <select
                  value={settlementEditAccountId}
                  onChange={(e) => setSettlementEditAccountId(e.target.value)}
                  disabled={!settlementEditAccounts.length}
                  className="w-full px-3 py-2 rounded-lg mb-2 disabled:opacity-60"
                  style={{ background: '#131722', color: '#d1d4dc', border: '1px solid #363a45' }}
                >
                  {!settlementEditAccounts.length && <option value="">No active account</option>}
                  {settlementEditAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.account_number || account.id} - {account.is_demo ? 'Demo' : 'Live'}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  value={settlementEditDate}
                  onChange={(e) => setSettlementEditDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg mb-2"
                  style={{ background: '#131722', color: '#d1d4dc', border: '1px solid #363a45' }}
                />
                <input
                  type="number"
                  step="0.01"
                  value={settlementEditAmount}
                  onChange={(e) => setSettlementEditAmount(e.target.value)}
                  placeholder="Balance settled value"
                  className="w-full px-3 py-2 rounded-lg mb-3"
                  style={{ background: '#131722', color: '#d1d4dc', border: '1px solid #363a45' }}
                />
                <button
                  onClick={updateSettlementBalance}
                  disabled={settlementEditLoading || !settlementEditAccountId}
                  className="w-full py-3 rounded-lg font-semibold text-white disabled:opacity-50"
                  style={{ background: '#26a69a' }}
                >
                  {settlementEditLoading ? 'Saving...' : 'Save Balance Settled'}
                </button>
              </div>
            </div>
          </div>
        )}

        {adminView === 'market' && (
          <div className="p-4 max-w-lg mx-auto">
            <div className="p-4 rounded-xl" style={{ background: '#2a2e39', border: '1px solid #363a45' }}>
              <div className="flex items-center gap-2 mb-4">
                <Calendar size={20} color="#f5c542" />
                <h3 className="font-bold text-lg" style={{ color: '#d1d4dc' }}>Market Holiday Control</h3>
              </div>

              <div className="p-3 rounded-lg mb-4" style={{
                background: holidayStatus.isHoliday ? '#ef535020' : '#26a69a20',
                border: `1px solid ${holidayStatus.isHoliday ? '#ef535050' : '#26a69a50'}`,
              }}>
                <div className="font-semibold" style={{ color: holidayStatus.isHoliday ? '#ef5350' : '#26a69a' }}>
                  {holidayStatus.isHoliday ? 'Holiday Enabled' : 'Normal Market'}
                </div>
                {holidayStatus.message && <div className="text-sm mt-1" style={{ color: '#787b86' }}>{holidayStatus.message}</div>}
                {holidayStatus.date && <div className="text-xs mt-1" style={{ color: '#f5c542' }}>Date: {holidayStatus.date}</div>}
              </div>

              <input type="text" value={holidayMessage} onChange={e => setHolidayMessage(e.target.value)} placeholder="Holiday message (e.g. Republic Day)"
                className="w-full px-4 py-3 rounded-lg text-sm mb-3"
                style={{ background: '#1e222d', border: '1px solid #363a45', color: '#d1d4dc' }} />
              <input type="date" value={holidayDate || ''} onChange={e => setHolidayDate(e.target.value)}
                className="w-full px-4 py-3 rounded-lg text-sm mb-3"
                style={{ background: '#1e222d', border: '1px solid #363a45', color: '#d1d4dc' }} />
              <div className="grid grid-cols-1 gap-2 mb-3">
                {[
                  ['nseBseClosed', 'NSE/BSE Full Close'],
                  ['mcxClosed', 'MCX Closed'],
                  ['mcxMorningOnly', 'MCX Morning Only'],
                ].map(([key, label]) => (
                  <label key={key} className="flex items-center justify-between px-3 py-2 rounded-lg text-sm" style={{ background: '#1e222d', border: '1px solid #363a45', color: '#d1d4dc' }}>
                    <span>{label}</span>
                    <input type="checkbox" checked={holidaySegments[key]} onChange={(e) => setHolidaySegments((prev) => ({ ...prev, [key]: e.target.checked }))} />
                  </label>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => toggleHoliday(true)} disabled={holidayLoading}
                  className="py-3 rounded-lg font-semibold text-white disabled:opacity-50"
                  style={{ background: '#ef5350' }}>Enable Holiday</button>
                <button onClick={() => toggleHoliday(false)} disabled={holidayLoading}
                  className="py-3 rounded-lg font-semibold text-white disabled:opacity-50"
                  style={{ background: '#26a69a' }}>Disable Holiday</button>
              </div>
            </div>
          </div>
        )}

        {adminView === 'manualClose' && (
          <div className="p-4 max-w-lg mx-auto">
            <div className="p-4 rounded-xl" style={{ background: '#2a2e39', border: '1px solid #363a45' }}>
              <div className="flex items-center gap-2 mb-4">
                <Lock size={20} color="#ef5350" />
                <h3 className="font-bold text-lg" style={{ color: '#d1d4dc' }}>Admin Manual Close</h3>
              </div>

              {/* Select User */}
              <div className="mb-3">
                <label className="block text-xs mb-1.5 font-medium" style={{ color: '#787b86' }}>Select User</label>
                <select value={selectedUserId} onChange={e => { setSelectedUserId(e.target.value); setManualTradeId(''); setPositionSearch(''); }}
                  className="w-full px-4 py-3 rounded-lg text-sm"
                  style={{ background: '#1e222d', border: '1px solid #363a45', color: '#d1d4dc' }}>
                  <option value="">Select user</option>
                  {adminUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.login_id} - {u.first_name || ''} {u.last_name || ''}</option>
                  ))}
                </select>
              </div>

              {selectedUserId && (
                <button onClick={() => fetchSelectedUserPositions(selectedUserId)} disabled={loadingSelectedUserPositions}
                  className="w-full mb-3 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-50 flex items-center justify-center gap-2"
                  style={{ background: '#2962ff' }}>
                  <RefreshCw size={16} className={loadingSelectedUserPositions ? 'animate-spin' : ''} />
                  {loadingSelectedUserPositions ? 'Loading Positions...' : 'Load Selected User Positions'}
                </button>
              )}

              {selectedUserId && (
                <div className="relative mb-3">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" color="#787b86" />
                  <input type="text" value={positionSearch} onChange={e => setPositionSearch(e.target.value)}
                    placeholder="Search by symbol or trade ID"
                    className="w-full pl-10 pr-4 py-3 rounded-lg text-sm"
                    style={{ background: '#1e222d', border: '1px solid #363a45', color: '#d1d4dc' }} />
                </div>
              )}

              {selectedUserId && (
                <div className="max-h-64 overflow-y-auto rounded-lg mb-3" style={{ border: '1px solid #363a45' }}>
                  {loadingSelectedUserPositions ? (
                    <div className="p-4 text-center text-sm" style={{ color: '#787b86' }}>Loading positions...</div>
                  ) : filteredSelectedUserPositions.length === 0 ? (
                    <div className="p-4 text-center text-sm" style={{ color: '#787b86' }}>No open positions for selected user</div>
                  ) : (
                    filteredSelectedUserPositions.map(pos => {
                      const pnl = Number(pos.profit || 0);
                      const isSelected = manualTradeId === pos.id;
                      return (
                        <div key={pos.id} onClick={() => setManualTradeId(pos.id)}
                          className="p-3 border-b cursor-pointer"
                          style={{ borderColor: '#363a45', background: isSelected ? '#2962ff20' : 'transparent' }}>
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-sm" style={{ color: '#d1d4dc' }}>{pos.symbol}</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{
                                  background: pos.trade_type === 'buy' ? '#26a69a20' : '#ef535020',
                                  color:      pos.trade_type === 'buy' ? '#26a69a'   : '#ef5350',
                                }}>
                                  {String(pos.trade_type || '').toUpperCase()} x{pos.quantity}
                                </span>
                              </div>
                              <div className="text-[11px] mt-1" style={{ color: '#787b86' }}>Trade ID: {pos.id}</div>
                              <div className="text-[11px]" style={{ color: '#787b86' }}>
                                Open: {Number(pos.open_price || 0).toFixed(2)} | Current: {Number(pos.current_price || pos.open_price || 0).toFixed(2)}
                              </div>
                            </div>
                            <div className="font-bold text-sm" style={{ color: pnl >= 0 ? '#26a69a' : '#ef5350' }}>
                              {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              <input type="text" value={manualTradeId} onChange={e => setManualTradeId(e.target.value)} placeholder="Selected Trade ID"
                className="w-full px-4 py-3 rounded-lg text-sm mb-3 font-mono"
                style={{ background: '#1e222d', border: '1px solid #363a45', color: '#d1d4dc' }} />

              {selectedManualPosition && (
                <div className="mb-3 p-3 rounded-lg" style={{ background: '#1e222d', border: '1px solid #363a45' }}>
                  <div className="flex items-center gap-2 mb-3">
                    <Edit3 size={16} color="#2962ff" />
                    <div className="text-sm font-semibold" style={{ color: '#d1d4dc' }}>
                      Edit Selected Position
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <input type="number" value={positionEdit.quantity} onChange={e => setPositionEdit(prev => ({ ...prev, quantity: e.target.value }))}
                      placeholder="Quantity"
                      className="w-full px-3 py-2.5 rounded-lg text-sm"
                      style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#d1d4dc' }} />
                    <input type="number" value={positionEdit.openPrice} onChange={e => setPositionEdit(prev => ({ ...prev, openPrice: e.target.value }))}
                      placeholder="Open price"
                      className="w-full px-3 py-2.5 rounded-lg text-sm"
                      style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#d1d4dc' }} />
                    <input type="number" value={positionEdit.currentPrice} onChange={e => setPositionEdit(prev => ({ ...prev, currentPrice: e.target.value }))}
                      placeholder="Current price"
                      className="w-full px-3 py-2.5 rounded-lg text-sm"
                      style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#d1d4dc' }} />
                    <input type="number" value={positionEdit.stopLoss} onChange={e => setPositionEdit(prev => ({ ...prev, stopLoss: e.target.value }))}
                      placeholder="Stop loss"
                      className="w-full px-3 py-2.5 rounded-lg text-sm"
                      style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#d1d4dc' }} />
                    <input type="number" value={positionEdit.takeProfit} onChange={e => setPositionEdit(prev => ({ ...prev, takeProfit: e.target.value }))}
                      placeholder="Take profit"
                      className="w-full px-3 py-2.5 rounded-lg text-sm col-span-2"
                      style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#d1d4dc' }} />
                  </div>

                  <input type="text" value={positionEdit.comment} onChange={e => setPositionEdit(prev => ({ ...prev, comment: e.target.value }))}
                    placeholder="Position note / comment"
                    className="w-full px-3 py-2.5 rounded-lg text-sm mb-3"
                    style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#d1d4dc' }} />

                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={handleUpdateSelectedPosition} disabled={positionEditLoading}
                      className="py-2.5 rounded-lg font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2"
                      style={{ background: '#2962ff' }}>
                      <Edit3 size={15} />
                      {positionEditLoading ? 'Saving...' : 'Save Edits'}
                    </button>
                    <button onClick={handleDeleteSelectedPosition} disabled={positionDeleteLoading}
                      className="py-2.5 rounded-lg font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2"
                      style={{ background: '#ef5350' }}>
                      <Trash2 size={15} />
                      {positionDeleteLoading ? 'Deleting...' : 'Delete Position'}
                    </button>
                  </div>
                </div>
              )}

              <input type="number" value={manualPrice} onChange={e => setManualPrice(e.target.value)} placeholder="Manual close price (optional)"
                className="w-full px-4 py-3 rounded-lg text-sm mb-3"
                style={{ background: '#1e222d', border: '1px solid #363a45', color: '#d1d4dc' }} />
              <input type="text" value={manualReason} onChange={e => setManualReason(e.target.value)} placeholder="Reason (optional)"
                className="w-full px-4 py-3 rounded-lg text-sm mb-4"
                style={{ background: '#1e222d', border: '1px solid #363a45', color: '#d1d4dc' }} />

              <button onClick={handleCloseAllSelectedUserPositions} disabled={closeAllLoading || !selectedUserId}
                className="w-full py-3 rounded-lg font-semibold text-white disabled:opacity-50 mb-3"
                style={{ background: '#ff9800' }}>
                {closeAllLoading ? 'Closing All...' : 'Close All Positions of Selected User'}
              </button>
              <button onClick={handleManualClose} disabled={manualLoading || !manualTradeId.trim()}
                className="w-full py-3 rounded-lg font-semibold text-white disabled:opacity-50"
                style={{ background: '#ef5350' }}>
                {manualLoading ? 'Closing...' : 'Close Selected Position'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
