import { useEffect, useState } from 'react';
import api from '../../services/api';
import { toast } from 'react-hot-toast';

export default function AdminWithdrawals() {
  const [status, setStatus] = useState('pending'); // pending | processing | completed | rejected | all
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [noteById, setNoteById] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/admin/withdrawals?status=${status}&limit=200`);
      setItems(res.data?.data || []);
    } catch (e) {
      console.error(e);
      toast.error(e.response?.data?.message || 'Failed to load withdrawals');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const approve = async (id) => {
    try {
      await api.post(`/admin/withdrawals/${id}/approve`, { note: noteById[id] || '' });
      toast.success('Approved');
      load();
    } catch (e) {
      console.error(e);
      toast.error(e.response?.data?.message || 'Approve failed');
    }
  };

  const reject = async (id) => {
    try {
      await api.post(`/admin/withdrawals/${id}/reject`, { note: noteById[id] || '' });
      toast.success('Rejected');
      load();
    } catch (e) {
      console.error(e);
      toast.error(e.response?.data?.message || 'Reject failed');
    }
  };

  return (
    <div className="h-full flex flex-col" style={{ background: '#1e222d' }}>
      <div className="p-4 border-b" style={{ borderColor: '#363a45' }}>
        <div className="text-lg font-bold" style={{ color: '#d1d4dc' }}>
          Admin • Withdrawals
        </div>

        <div className="flex gap-2 mt-3 overflow-x-auto">
          {['pending', 'processing', 'completed', 'rejected', 'all'].map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className="px-3 py-1.5 rounded text-xs font-medium"
              style={{
                background: status === s ? '#2962ff' : '#2a2e39',
                color: status === s ? '#fff' : '#787b86',
              }}
            >
              {s.toUpperCase()}
            </button>
          ))}

          <button
            onClick={load}
            className="ml-auto px-3 py-1.5 rounded text-xs"
            style={{ background: '#2a2e39', color: '#d1d4dc', border: '1px solid #363a45' }}
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div style={{ color: '#787b86' }}>Loading...</div>
        ) : items.length === 0 ? (
          <div style={{ color: '#787b86' }}>No withdrawals</div>
        ) : (
          items.map((w) => (
            <div
              key={w.id}
              className="p-3 rounded-lg mb-2"
              style={{ background: '#2a2e39', border: '1px solid #363a45' }}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div style={{ color: '#d1d4dc', fontWeight: 700 }}>
                    Amount: ₹{Number(w.amount || 0).toFixed(2)}
                  </div>
                  <div className="text-xs" style={{ color: '#787b86' }}>
                    Status: {String(w.status || '').toUpperCase()}
                  </div>
                  <div className="text-xs" style={{ color: '#787b86' }}>
                    User ID: {w.user_id}
                  </div>
                  <div className="text-xs" style={{ color: '#787b86' }}>
                    Account ID: {w.account_id}
                  </div>
                  <div className="text-xs" style={{ color: '#787b86' }}>
                    Created: {w.created_at ? new Date(w.created_at).toLocaleString() : '-'}
                  </div>
                </div>

                {(w.status === 'pending' || w.status === 'processing') && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => approve(w.id)}
                      className="px-3 py-1.5 rounded text-xs font-semibold"
                      style={{ background: '#26a69a', color: '#fff' }}
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => reject(w.id)}
                      className="px-3 py-1.5 rounded text-xs font-semibold"
                      style={{ background: '#ef5350', color: '#fff' }}
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-2">
                <input
                  value={noteById[w.id] || ''}
                  onChange={(e) => setNoteById((p) => ({ ...p, [w.id]: e.target.value }))}
                  placeholder="Admin note (optional)"
                  className="w-full px-3 py-2 rounded text-sm"
                  style={{ background: '#1e222d', border: '1px solid #363a45', color: '#d1d4dc' }}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}