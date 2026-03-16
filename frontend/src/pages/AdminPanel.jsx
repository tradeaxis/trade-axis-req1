import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Calendar, Lock } from 'lucide-react';
import AdminUsers from '../components/admin/AdminUsers';
import AdminWithdrawals from '../components/admin/AdminWithdrawals';
import AdminKiteSetup from '../components/admin/AdminKiteSetup';
import api from '../services/api';

export default function AdminPanel() {
  const [adminView, setAdminView] = useState('users');

  const [holidayStatus, setHolidayStatus] = useState({
    isHoliday: false,
    message: '',
    marketOpen: true,
  });
  const [holidayMessage, setHolidayMessage] = useState('');
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
      if (res.data?.success) {
        setHolidayStatus(res.data.data || {});
      }
    } catch (e) {
      console.error(e);
    }
  };

  const toggleHoliday = async (enable) => {
    setHolidayLoading(true);
    try {
      const res = await api.post('/admin/market-holiday', {
        isHoliday: enable,
        message: enable ? holidayMessage : '',
      });

      if (res.data?.success) {
        setHolidayStatus({
          ...(res.data.data || {}),
          isHoliday: enable,
          message: enable ? holidayMessage : '',
        });
        toast.success(res.data.message || 'Market holiday updated');
        if (!enable) setHolidayMessage('');
      } else {
        toast.error(res.data?.message || 'Failed to update');
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to update market holiday');
    } finally {
      setHolidayLoading(false);
    }
  };

  const handleManualClose = async () => {
    if (!manualTradeId.trim()) {
      return toast.error('Trade ID is required');
    }

    setManualLoading(true);
    try {
      const res = await api.post('/admin/close-position', {
        tradeId: manualTradeId.trim(),
        closePrice: manualPrice ? Number(manualPrice) : undefined,
        reason: manualReason || 'Admin manual close',
      });

      if (res.data?.success) {
        toast.success(res.data.message || 'Position closed');
        setManualTradeId('');
        setManualPrice('');
        setManualReason('');
      } else {
        toast.error(res.data?.message || 'Manual close failed');
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Manual close failed');
    } finally {
      setManualLoading(false);
    }
  };

  const tabs = [
    { id: 'users', label: 'Users' },
    { id: 'withdrawals', label: 'Withdrawals' },
    { id: 'market', label: 'Market Holiday' },
    { id: 'manualClose', label: 'Manual Close' },
    { id: 'kite', label: '🔌 Kite Setup' },
  ];

  return (
    <div className="flex flex-col h-full" style={{ background: '#1e222d' }}>
      <div className="flex border-b overflow-x-auto" style={{ borderColor: '#363a45' }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setAdminView(tab.id)}
            className="flex-1 py-3 text-sm font-medium border-b-2 whitespace-nowrap px-4"
            style={{
              color: adminView === tab.id ? '#2962ff' : '#787b86',
              borderColor: adminView === tab.id ? '#2962ff' : 'transparent',
              minWidth: '120px',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {adminView === 'users' && <AdminUsers />}
        {adminView === 'withdrawals' && <AdminWithdrawals />}
        {adminView === 'kite' && <AdminKiteSetup />}

        {adminView === 'market' && (
          <div className="p-4 max-w-lg mx-auto">
            <div
              className="p-4 rounded-xl"
              style={{ background: '#2a2e39', border: '1px solid #363a45' }}
            >
              <div className="flex items-center gap-2 mb-4">
                <Calendar size={20} color="#f5c542" />
                <h3 className="font-bold text-lg" style={{ color: '#d1d4dc' }}>
                  Market Holiday Control
                </h3>
              </div>

              <div
                className="p-3 rounded-lg mb-4"
                style={{
                  background: holidayStatus.isHoliday ? '#ef535020' : '#26a69a20',
                  border: `1px solid ${holidayStatus.isHoliday ? '#ef535050' : '#26a69a50'}`,
                }}
              >
                <div
                  className="font-semibold"
                  style={{ color: holidayStatus.isHoliday ? '#ef5350' : '#26a69a' }}
                >
                  {holidayStatus.isHoliday ? 'Holiday Enabled' : 'Normal Market'}
                </div>
                {holidayStatus.message && (
                  <div className="text-sm mt-1" style={{ color: '#787b86' }}>
                    {holidayStatus.message}
                  </div>
                )}
              </div>

              <input
                type="text"
                value={holidayMessage}
                onChange={(e) => setHolidayMessage(e.target.value)}
                placeholder="Holiday message"
                className="w-full px-4 py-3 rounded-lg text-sm mb-3"
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
          </div>
        )}

        {adminView === 'manualClose' && (
          <div className="p-4 max-w-lg mx-auto">
            <div
              className="p-4 rounded-xl"
              style={{ background: '#2a2e39', border: '1px solid #363a45' }}
            >
              <div className="flex items-center gap-2 mb-4">
                <Lock size={20} color="#ef5350" />
                <h3 className="font-bold text-lg" style={{ color: '#d1d4dc' }}>
                  Admin Manual Close
                </h3>
              </div>

              <input
                type="text"
                value={manualTradeId}
                onChange={(e) => setManualTradeId(e.target.value)}
                placeholder="Trade ID"
                className="w-full px-4 py-3 rounded-lg text-sm mb-3 font-mono"
                style={{
                  background: '#1e222d',
                  border: '1px solid #363a45',
                  color: '#d1d4dc',
                }}
              />

              <input
                type="number"
                value={manualPrice}
                onChange={(e) => setManualPrice(e.target.value)}
                placeholder="Manual close price"
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

              <button
                onClick={handleManualClose}
                disabled={manualLoading || !manualTradeId.trim()}
                className="w-full py-3 rounded-lg font-semibold text-white disabled:opacity-50"
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