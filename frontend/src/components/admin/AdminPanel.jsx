// frontend/src/components/admin/AdminPanel.jsx
import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { Calendar, Lock, X, RefreshCw, ChevronDown, Search } from 'lucide-react';
import AdminUsers from './AdminUsers';
import AdminWithdrawals from './AdminWithdrawals';
import api from '../../services/api';

export default function AdminPanel() {
  const [tab, setTab] = useState('users');
  const [holidayStatus, setHolidayStatus] = useState({ isHoliday: false, message: '' });
  const [holidayMsg, setHolidayMsg] = useState('');
  const [holidayLoading, setHolidayLoading] = useState(false);

  const [manualTradeId, setManualTradeId] = useState('');
  const [manualPrice, setManualPrice] = useState('');
  const [manualReason, setManualReason] = useState('');
  const [manualLoading, setManualLoading] = useState(false);

  // ✅ NEW: Open positions state for admin manual close
  const [openPositions, setOpenPositions] = useState([]);
  const [loadingPositions, setLoadingPositions] = useState(false);
  const [positionSearch, setPositionSearch] = useState('');
  const [showPositionsList, setShowPositionsList] = useState(false);

  useEffect(() => {
    fetchHolidayStatus();
  }, []);

  const fetchHolidayStatus = async () => {
    try {
      const res = await api.get('/admin/market-holiday');
      if (res.data.success) setHolidayStatus(res.data.data);
    } catch (e) {}
  };

  const toggleHoliday = async (enable) => {
    setHolidayLoading(true);
    try {
      const res = await api.post('/admin/market-holiday', {
        isHoliday: enable,
        message: enable ? holidayMsg : '',
      });
      if (res.data.success) {
        toast.success(res.data.message);
        setHolidayStatus(res.data.data);
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed');
    } finally {
      setHolidayLoading(false);
    }
  };

  // ✅ NEW: Fetch all open positions from admin endpoint
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

  // ✅ Filter positions by search
  const filteredPositions = positionSearch.trim()
    ? openPositions.filter((p) => {
        const term = positionSearch.trim().toLowerCase();
        return (
          (p.symbol || '').toLowerCase().includes(term) ||
          (p.user_login_id || '').toLowerCase().includes(term) ||
          (p.id || '').toLowerCase().includes(term)
        );
      })
    : openPositions;

  const adminManualClose = async () => {
    if (!manualTradeId) return toast.error('Trade ID required');
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
        // Refresh positions list if it was open
        if (showPositionsList) {
          fetchAllOpenPositions();
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
            <div className="p-5 rounded-xl" style={{ background: '#2a2e39', border: '1px solid #363a45' }}>
              <div className="flex items-center gap-3 mb-4">
                <Calendar size={24} color="#f5c542" />
                <h3 className="font-bold text-lg" style={{ color: '#d1d4dc' }}>Market Holiday</h3>
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
              </div>

              <input
                type="text"
                value={holidayMsg}
                onChange={(e) => setHolidayMsg(e.target.value)}
                placeholder="Holiday reason (e.g. Republic Day)"
                className="w-full px-4 py-3 rounded-lg text-sm mb-4"
                style={{ background: '#1e222d', border: '1px solid #363a45', color: '#d1d4dc' }}
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

            {/* ✅ UPDATED: Admin Manual Close with Open Positions List */}
            <div className="p-5 rounded-xl" style={{ background: '#2a2e39', border: '1px solid #363a45' }}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <Lock size={24} color="#ef5350" />
                  <h3 className="font-bold text-lg" style={{ color: '#d1d4dc' }}>
                    Admin Manual Close
                  </h3>
                </div>
                <button
                  onClick={fetchAllOpenPositions}
                  disabled={loadingPositions}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
                  style={{ background: '#2962ff', color: '#fff' }}
                >
                  <RefreshCw size={14} className={loadingPositions ? 'animate-spin' : ''} />
                  {loadingPositions ? 'Loading...' : 'Load Positions'}
                </button>
              </div>

              {/* ✅ Open Positions List */}
              {showPositionsList && openPositions.length > 0 && (
                <div className="mb-4">
                  {/* Search within positions */}
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
                      placeholder="Search by symbol, user ID, or trade ID..."
                      className="w-full pl-9 pr-3 py-2 rounded-lg text-xs"
                      style={{
                        background: '#1e222d',
                        border: '1px solid #363a45',
                        color: '#d1d4dc',
                      }}
                    />
                  </div>

                  <div className="text-xs mb-1 flex items-center justify-between" style={{ color: '#787b86' }}>
                    <span>{filteredPositions.length} open position{filteredPositions.length !== 1 ? 's' : ''}</span>
                    <button
                      onClick={() => setShowPositionsList(false)}
                      className="text-xs px-2 py-1 rounded"
                      style={{ color: '#787b86' }}
                    >
                      Hide
                    </button>
                  </div>

                  <div
                    className="max-h-72 overflow-y-auto rounded-lg"
                    style={{ border: '1px solid #363a45' }}
                  >
                    {filteredPositions.length === 0 ? (
                      <div className="p-4 text-center text-xs" style={{ color: '#787b86' }}>
                        {positionSearch ? 'No positions match your search' : 'No open positions'}
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
                                  →{' '}
                                  {Number(pos.current_price || pos.open_price || 0).toFixed(2)}
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
                                  ? new Date(pos.open_time).toLocaleDateString(
                                      'en-IN',
                                      { day: '2-digit', month: 'short' }
                                    )
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

              {showPositionsList && openPositions.length === 0 && !loadingPositions && (
                <div
                  className="p-4 mb-4 rounded-lg text-center text-sm"
                  style={{ background: '#1e222d', color: '#787b86' }}
                >
                  No open positions found across all users
                </div>
              )}

              {/* Trade ID Input */}
              <div className="mb-3">
                <label className="block text-xs mb-1.5 font-medium" style={{ color: '#787b86' }}>
                  Trade ID {openPositions.length > 0 && '(select from list above or paste)'}
                </label>
                <input
                  type="text"
                  value={manualTradeId}
                  onChange={(e) => setManualTradeId(e.target.value)}
                  placeholder="Trade ID"
                  className="w-full px-4 py-3 rounded-lg text-sm font-mono"
                  style={{
                    background: '#1e222d',
                    border: manualTradeId
                      ? '1px solid #2962ff'
                      : '1px solid #363a45',
                    color: '#d1d4dc',
                  }}
                />
                {manualTradeId && (
                  <div className="text-[10px] mt-1" style={{ color: '#2962ff' }}>
                    ✓ Trade ID selected: {manualTradeId.substring(0, 20)}
                    {manualTradeId.length > 20 ? '...' : ''}
                  </div>
                )}
              </div>

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

              {/* Selected position preview */}
              {manualTradeId && openPositions.length > 0 && (() => {
                const selectedPos = openPositions.find((p) => p.id === manualTradeId);
                if (!selectedPos) return null;
                const pnl = Number(selectedPos.profit || 0);
                return (
                  <div
                    className="p-3 rounded-lg mb-4"
                    style={{
                      background: '#1e222d',
                      border: `1px solid ${pnl >= 0 ? '#26a69a50' : '#ef535050'}`,
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-bold text-sm" style={{ color: '#d1d4dc' }}>
                          {selectedPos.symbol}
                        </span>
                        <span
                          className="ml-2 text-xs"
                          style={{
                            color:
                              selectedPos.trade_type === 'buy'
                                ? '#26a69a'
                                : '#ef5350',
                          }}
                        >
                          {(selectedPos.trade_type || '').toUpperCase()} x
                          {selectedPos.quantity}
                        </span>
                      </div>
                      <span
                        className="font-bold text-sm"
                        style={{ color: pnl >= 0 ? '#26a69a' : '#ef5350' }}
                      >
                        P&L: {pnl >= 0 ? '+' : ''}
                        {pnl.toFixed(2)}
                      </span>
                    </div>
                    <div className="text-[10px] mt-1" style={{ color: '#787b86' }}>
                      User: {selectedPos.user_login_id} • Open @{' '}
                      {Number(selectedPos.open_price || 0).toFixed(2)} • Current @{' '}
                      {Number(
                        selectedPos.current_price || selectedPos.open_price || 0
                      ).toFixed(2)}
                    </div>
                  </div>
                );
              })()}

              <button
                onClick={adminManualClose}
                disabled={manualLoading || !manualTradeId}
                className="w-full py-3.5 rounded-lg font-semibold text-white disabled:opacity-50"
                style={{ background: '#ef5350' }}
              >
                {manualLoading ? 'Closing...' : 'Manually Close Position'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}