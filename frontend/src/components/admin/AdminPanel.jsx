import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { Calendar, Lock, X } from 'lucide-react';
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
        setManualTradeId(''); setManualPrice(''); setManualReason('');
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

              <div className={`p-3 rounded-lg mb-4 ${holidayStatus.isHoliday ? 'bg-red-500/10 border border-red-500/30' : 'bg-green-500/10 border border-green-500/30'}`}>
                <div className="font-medium" style={{ color: holidayStatus.isHoliday ? '#ef5350' : '#26a69a' }}>
                  {holidayStatus.isHoliday ? 'HOLIDAY IS ACTIVE' : 'Market is Open'}
                </div>
                {holidayStatus.message && <div className="text-sm mt-1" style={{ color: '#787b86' }}>{holidayStatus.message}</div>}
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

            {/* Admin Manual Close */}
            <div className="p-5 rounded-xl" style={{ background: '#2a2e39', border: '1px solid #363a45' }}>
              <div className="flex items-center gap-3 mb-4">
                <Lock size={24} color="#ef5350" />
                <h3 className="font-bold text-lg" style={{ color: '#d1d4dc' }}>Admin Manual Close</h3>
              </div>

              <input
                type="text"
                value={manualTradeId}
                onChange={(e) => setManualTradeId(e.target.value)}
                placeholder="Trade ID"
                className="w-full px-4 py-3 rounded-lg text-sm mb-3 font-mono"
                style={{ background: '#1e222d', border: '1px solid #363a45', color: '#d1d4dc' }}
              />

              <input
                type="number"
                value={manualPrice}
                onChange={(e) => setManualPrice(e.target.value)}
                placeholder="Close Price (optional)"
                className="w-full px-4 py-3 rounded-lg text-sm mb-3"
                style={{ background: '#1e222d', border: '1px solid #363a45', color: '#d1d4dc' }}
              />

              <input
                type="text"
                value={manualReason}
                onChange={(e) => setManualReason(e.target.value)}
                placeholder="Reason (optional)"
                className="w-full px-4 py-3 rounded-lg text-sm mb-4"
                style={{ background: '#1e222d', border: '1px solid #363a45', color: '#d1d4dc' }}
              />

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