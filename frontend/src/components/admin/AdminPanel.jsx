// frontend/src/components/admin/AdminPanel.jsx
import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { Calendar, Lock, RefreshCw, Search } from 'lucide-react';
import AdminUsers from './AdminUsers';
import AdminWithdrawals from './AdminWithdrawals';
import api from '../../services/api';

export default function AdminPanel() {
  const [tab, setTab] = useState('users');

  const [holidayStatus, setHolidayStatus] = useState({
    isHoliday: false,
    message: '',
    date: null,
  });
  const [holidayMsg, setHolidayMsg] = useState('');
  const [holidayDate, setHolidayDate] = useState('');
  const [holidayLoading, setHolidayLoading] = useState(false);

  const [manualTradeId, setManualTradeId] = useState('');
  const [manualPrice, setManualPrice] = useState('');
  const [manualReason, setManualReason] = useState('');
  const [manualLoading, setManualLoading] = useState(false);

  const [openPositions, setOpenPositions] = useState([]);
  const [loadingPositions, setLoadingPositions] = useState(false);
  const [positionSearch, setPositionSearch] = useState('');
  const [showPositionsList, setShowPositionsList] = useState(false);

  const [adminUsers, setAdminUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedUserPositions, setSelectedUserPositions] = useState([]);
  const [loadingSelectedUserPositions, setLoadingSelectedUserPositions] = useState(false);
  const [closeAllLoading, setCloseAllLoading] = useState(false);

  useEffect(() => {
    fetchHolidayStatus();
    fetchAdminUsers();
  }, []);

  useEffect(() => {
    if (selectedUserId) {
      fetchSelectedUserPositions(selectedUserId);
    } else {
      setSelectedUserPositions([]);
      setManualTradeId('');
    }
  }, [selectedUserId]);

  const fetchHolidayStatus = async () => {
    try {
      const res = await api.get('/admin/market-holiday');
      if (res.data.success) {
        setHolidayStatus(res.data.data || {});
        setHolidayMsg(res.data.data?.message || '');
        setHolidayDate(res.data.data?.date || '');
      }
    } catch (e) {
      console.error('fetchHolidayStatus error:', e);
    }
  };

  const fetchAdminUsers = async () => {
    try {
      const res = await api.get('/admin/users?limit=500');
      if (res.data.success) {
        setAdminUsers(res.data.data || []);
      }
    } catch (e) {
      console.error('Failed to fetch admin users', e);
    }
  };

  const toggleHoliday = async (enable) => {
    setHolidayLoading(true);
    try {
      const res = await api.post('/admin/market-holiday', {
        isHoliday: enable,
        message: enable ? holidayMsg : '',
        date: enable ? holidayDate || null : null,
      });

      if (res.data.success) {
        toast.success(res.data.message);
        setHolidayStatus(res.data.data || {});
        if (!enable) {
          setHolidayMsg('');
          setHolidayDate('');
        }
      } else {
        toast.error(res.data?.message || 'Failed');
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed');
    } finally {
      setHolidayLoading(false);
    }
  };

  const fetchAllOpenPositions = async () => {
    setLoadingPositions(true);
    try {
      const res = await api.get('/admin/open-positions');
      if (res.data.success) {
        setOpenPositions(res.data.data || []);
        setShowPositionsList(true);
      } else {
        toast.error(res.data.message || 'Failed to load positions');
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load open positions');
    } finally {
      setLoadingPositions(false);
    }
  };

  const fetchSelectedUserPositions = async (userId) => {
    if (!userId) {
      setSelectedUserPositions([]);
      return;
    }

    setLoadingSelectedUserPositions(true);
    try {
      const res = await api.get(`/admin/users/${userId}/open-positions`);
      if (res.data.success) {
        setSelectedUserPositions(res.data.data || []);
        setShowPositionsList(true);
      } else {
        toast.error(res.data.message || 'Failed to load selected user positions');
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load selected user positions');
    } finally {
      setLoadingSelectedUserPositions(false);
    }
  };

  const filteredPositions = (selectedUserId ? selectedUserPositions : openPositions).filter((p) => {
    const term = positionSearch.trim().toLowerCase();
    return (
      !term ||
      (p.symbol || '').toLowerCase().includes(term) ||
      (p.user_login_id || '').toLowerCase().includes(term) ||
      (p.id || '').toLowerCase().includes(term)
    );
  });

  const adminManualClose = async () => {
    if (!manualTradeId) return toast.error('Please select a position first');

    setManualLoading(true);
    try {
      const res = await api.post('/admin/close-position', {
        tradeId: manualTradeId.trim(),
        closePrice: manualPrice ? Number(manualPrice) : undefined,
        reason: manualReason || 'Admin manual close',
      });

      if (res.data.success) {
        toast.success(res.data.message);
        setManualTradeId('');
        setManualPrice('');
        setManualReason('');

        if (selectedUserId) {
          await fetchSelectedUserPositions(selectedUserId);
        } else {
          await fetchAllOpenPositions();
        }
      } else {
        toast.error(res.data.message);
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed');
    } finally {
      setManualLoading(false);
    }
  };

  const adminCloseAllSelectedUserPositions = async () => {
    if (!selectedUserId) {
      return toast.error('Please select a user first');
    }

    if (!window.confirm('Close ALL open positions of selected user?')) return;

    setCloseAllLoading(true);
    try {
      const res = await api.post('/admin/users/close-all-positions', {
        userId: selectedUserId,
        closePrice: manualPrice ? Number(manualPrice) : undefined,
        reason: manualReason || 'Admin close all positions',
      });

      if (res.data.success) {
        toast.success(res.data.message || 'All positions closed');
        setManualTradeId('');
        setManualPrice('');
        setManualReason('');
        await fetchSelectedUserPositions(selectedUserId);
        await fetchAllOpenPositions();
      } else {
        toast.error(res.data.message || 'Failed to close all positions');
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to close all positions');
    } finally {
      setCloseAllLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col" style={{ background: '#1e222d' }}>
      <div className="flex border-b" style={{ borderColor: '#363a45' }}>
        {[
          { id: 'users', label: 'Users' },
          { id: 'withdrawals', label: 'Withdrawals' },
          { id: 'market', label: 'Market' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="px-5 py-3 text-sm font-medium border-b-2"
            style={{
              borderColor: tab === t.id ? '#2962ff' : 'transparent',
              color: tab === t.id ? '#d1d4dc' : '#787b86',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {tab === 'users' && <AdminUsers />}
        {tab === 'withdrawals' && <AdminWithdrawals />}

        {tab === 'market' && (
          <div className="max-w-md mx-auto space-y-6">
            {/* Market Holiday */}
            <div
              className="p-5 rounded-xl"
              style={{ background: '#2a2e39', border: '1px solid #363a45' }}
            >
              <div className="flex items-center gap-3 mb-4">
                <Calendar size={24} color="#f5c542" />
                <h3 className="font-bold text-lg" style={{ color: '#d1d4dc' }}>
                  Market Holiday
                </h3>
              </div>

              <div
                className={`p-3 rounded-lg mb-4 ${
                  holidayStatus.isHoliday
                    ? 'bg-red-500/10 border border-red-500/30'
                    : 'bg-green-500/10 border border-green-500/30'
                }`}
              >
                <div
                  className="font-medium"
                  style={{ color: holidayStatus.isHoliday ? '#ef5350' : '#26a69a' }}
                >
                  {holidayStatus.isHoliday ? 'HOLIDAY IS ACTIVE' : 'Market is Open'}
                </div>
                {holidayStatus.message && (
                  <div className="text-sm mt-1" style={{ color: '#787b86' }}>
                    {holidayStatus.message}
                  </div>
                )}
                {holidayStatus.date && (
                  <div className="text-xs mt-1" style={{ color: '#f5c542' }}>
                    Date: {holidayStatus.date}
                  </div>
                )}
              </div>

              <input
                type="text"
                value={holidayMsg}
                onChange={(e) => setHolidayMsg(e.target.value)}
                placeholder="Holiday reason (e.g. Republic Day)"
                className="w-full px-4 py-3 rounded-lg text-sm mb-3"
                style={{
                  background: '#1e222d',
                  border: '1px solid #363a45',
                  color: '#d1d4dc',
                }}
              />

              <input
                type="date"
                value={holidayDate}
                onChange={(e) => setHolidayDate(e.target.value)}
                className="w-full px-4 py-3 rounded-lg text-sm mb-4"
                style={{
                  background: '#1e222d',
                  border: '1px solid #363a45',
                  color: '#d1d4dc',
                }}
              />

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => toggleHoliday(true)}
                  disabled={holidayLoading}
                  className="py-3 rounded-lg font-semibold text-white disabled:opacity-50"
                  style={{ background: '#ef5350' }}
                >
                  Enable Holiday
                </button>
                <button
                  onClick={() => toggleHoliday(false)}
                  disabled={holidayLoading}
                  className="py-3 rounded-lg font-semibold text-white disabled:opacity-50"
                  style={{ background: '#26a69a' }}
                >
                  Disable Holiday
                </button>
              </div>
            </div>

            {/* Admin Manual Close */}
            <div
              className="p-5 rounded-xl"
              style={{ background: '#2a2e39', border: '1px solid #363a45' }}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <Lock size={24} color="#ef5350" />
                  <h3 className="font-bold text-lg" style={{ color: '#d1d4dc' }}>
                    Admin Manual Close
                  </h3>
                </div>
                <button
                  onClick={selectedUserId ? () => fetchSelectedUserPositions(selectedUserId) : fetchAllOpenPositions}
                  disabled={loadingPositions || loadingSelectedUserPositions}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
                  style={{ background: '#2962ff', color: '#fff' }}
                >
                  <RefreshCw
                    size={14}
                    className={loadingPositions || loadingSelectedUserPositions ? 'animate-spin' : ''}
                  />
                  {loadingPositions || loadingSelectedUserPositions ? 'Loading...' : 'Load Positions'}
                </button>
              </div>

              {/* Select User */}
              <div className="mb-3">
                <label
                  className="block text-xs mb-1.5 font-medium"
                  style={{ color: '#787b86' }}
                >
                  Select User
                </label>
                <select
                  value={selectedUserId}
                  onChange={(e) => {
                    const userId = e.target.value;
                    setSelectedUserId(userId);
                    setManualTradeId('');
                    setPositionSearch('');
                  }}
                  className="w-full px-3 py-2.5 rounded-lg text-sm"
                  style={{
                    background: '#1e222d',
                    border: '1px solid #363a45',
                    color: '#d1d4dc',
                  }}
                >
                  <option value="">Select a user</option>
                  {adminUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.login_id} - {u.first_name || ''} {u.last_name || ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Positions list */}
              {showPositionsList && (
                <div className="mb-4">
                  <div className="relative mb-2">
                    <Search
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2"
                      color="#787b86"
                    />
                    <input
                      type="text"
                      value={positionSearch}
                      onChange={(e) => setPositionSearch(e.target.value)}
                      placeholder="Search by symbol or trade ID..."
                      className="w-full pl-9 pr-3 py-2 rounded-lg text-xs"
                      style={{
                        background: '#1e222d',
                        border: '1px solid #363a45',
                        color: '#d1d4dc',
                      }}
                    />
                  </div>

                  <div
                    className="max-h-72 overflow-y-auto rounded-lg"
                    style={{ border: '1px solid #363a45' }}
                  >
                    {(loadingPositions || loadingSelectedUserPositions) ? (
                      <div className="p-4 text-center text-xs" style={{ color: '#787b86' }}>
                        Loading positions...
                      </div>
                    ) : filteredPositions.length === 0 ? (
                      <div className="p-4 text-center text-xs" style={{ color: '#787b86' }}>
                        {selectedUserId
                          ? 'No open positions for selected user'
                          : 'No open positions'}
                      </div>
                    ) : (
                      filteredPositions.map((pos) => {
                        const pnl = Number(pos.profit || 0);
                        const isSelected = manualTradeId === pos.id;

                        return (
                          <div
                            key={pos.id}
                            className="flex items-center justify-between p-2.5 border-b cursor-pointer hover:bg-white/5 transition-colors"
                            style={{
                              borderColor: '#363a45',
                              background: isSelected ? '#2962ff15' : 'transparent',
                              borderLeft: isSelected ? '3px solid #2962ff' : '3px solid transparent',
                            }}
                            onClick={() => {
                              setManualTradeId(pos.id);
                              toast.success(`Selected: ${pos.symbol} (${pos.user_login_id})`);
                            }}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span
                                  className="text-sm font-bold"
                                  style={{ color: '#d1d4dc' }}
                                >
                                  {pos.symbol}
                                </span>
                                <span
                                  className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                                  style={{
                                    background:
                                      pos.trade_type === 'buy'
                                        ? '#26a69a20'
                                        : '#ef535020',
                                    color:
                                      pos.trade_type === 'buy'
                                        ? '#26a69a'
                                        : '#ef5350',
                                  }}
                                >
                                  {(pos.trade_type || '').toUpperCase()} x{pos.quantity}
                                </span>
                              </div>

                              <div
                                className="flex items-center gap-2 mt-0.5 text-[10px]"
                                style={{ color: '#787b86' }}
                              >
                                <span
                                  className="font-mono font-medium"
                                  style={{ color: '#2962ff' }}
                                >
                                  {pos.user_login_id || '—'}
                                </span>
                                <span>@ {Number(pos.open_price || 0).toFixed(2)}</span>
                                <span>
                                  → {Number(pos.current_price || pos.open_price || 0).toFixed(2)}
                                </span>
                              </div>
                            </div>

                            <div className="text-right shrink-0 ml-2">
                              <div
                                className="text-xs font-bold"
                                style={{
                                  color: pnl >= 0 ? '#26a69a' : '#ef5350',
                                }}
                              >
                                {pnl >= 0 ? '+' : ''}
                                {pnl.toFixed(2)}
                              </div>
                              <div
                                className="text-[9px] mt-0.5"
                                style={{ color: '#787b86' }}
                              >
                                {pos.open_time
                                  ? new Date(pos.open_time).toLocaleDateString('en-IN', {
                                      day: '2-digit',
                                      month: 'short',
                                    })
                                  : ''}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* Trade ID */}
              <div className="mb-3">
                <label className="block text-xs mb-1.5 font-medium" style={{ color: '#787b86' }}>
                  Selected Trade ID
                </label>
                <input
                  type="text"
                  value={manualTradeId}
                  onChange={(e) => setManualTradeId(e.target.value)}
                  placeholder="Select a position from above"
                  className="w-full px-4 py-3 rounded-lg text-sm font-mono"
                  style={{
                    background: '#1e222d',
                    border: manualTradeId ? '1px solid #2962ff' : '1px solid #363a45',
                    color: '#d1d4dc',
                  }}
                />
              </div>

              {/* Close Price */}
              <input
                type="number"
                value={manualPrice}
                onChange={(e) => setManualPrice(e.target.value)}
                placeholder="Close Price (optional — uses live price if empty)"
                className="w-full px-4 py-3 rounded-lg text-sm mb-3"
                style={{
                  background: '#1e222d',
                  border: '1px solid #363a45',
                  color: '#d1d4dc',
                }}
              />

              {/* Reason */}
              <input
                type="text"
                value={manualReason}
                onChange={(e) => setManualReason(e.target.value)}
                placeholder="Reason (optional)"
                className="w-full px-4 py-3 rounded-lg text-sm mb-4"
                style={{
                  background: '#1e222d',
                  border: '1px solid #363a45',
                  color: '#d1d4dc',
                }}
              />

              {/* Close all selected user positions */}
              {selectedUserId && (
                <button
                  onClick={adminCloseAllSelectedUserPositions}
                  disabled={closeAllLoading || filteredPositions.length === 0}
                  className="w-full py-3 rounded-lg font-semibold text-white disabled:opacity-50 mb-3"
                  style={{ background: '#ff9800' }}
                >
                  {closeAllLoading
                    ? 'Closing All...'
                    : `Close All Positions of Selected User (${filteredPositions.length})`}
                </button>
              )}

              {/* Close one selected position */}
              <button
                onClick={adminManualClose}
                disabled={manualLoading || !manualTradeId}
                className="w-full py-3.5 rounded-lg font-semibold text-white disabled:opacity-50"
                style={{ background: '#ef5350' }}
              >
                {manualLoading ? 'Closing...' : 'Close Selected Position'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}