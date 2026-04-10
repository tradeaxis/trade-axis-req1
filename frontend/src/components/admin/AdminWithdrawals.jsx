// frontend/src/components/admin/AdminWithdrawals.jsx
import { useEffect, useState } from 'react';
import api from '../../services/api';
import { toast } from 'react-hot-toast';
import { RefreshCw, CheckCircle, XCircle, Clock, DollarSign } from 'lucide-react';

export default function AdminWithdrawals() {
  const [loading, setLoading] = useState(false);
  const [withdrawals, setWithdrawals] = useState([]);
  const [statusFilter, setStatusFilter] = useState('pending');

  const loadWithdrawals = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/admin/withdrawals?status=${statusFilter}`);
      console.log('Withdrawals:', res.data);
      
      if (res.data?.success) {
        setWithdrawals(res.data.data || []);
      }
    } catch (e) {
      console.error(e);
      toast.error('Failed to load withdrawals');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWithdrawals();
  }, [statusFilter]);

  const approveWithdrawal = async (id) => {
    if (!window.confirm('Approve this withdrawal?')) return;
    
    try {
      await api.post(`/admin/withdrawals/${id}/approve`, { adminNote: 'Approved by admin' });
      toast.success('Withdrawal approved');
      loadWithdrawals();
    } catch (e) {
      console.error(e);
      toast.error(e.response?.data?.message || 'Approval failed');
    }
  };

  const rejectWithdrawal = async (id) => {
    const reason = window.prompt('Rejection reason (optional):');
    
    try {
      await api.post(`/admin/withdrawals/${id}/reject`, { adminNote: reason || 'Rejected by admin' });
      toast.success('Withdrawal rejected');
      loadWithdrawals();
    } catch (e) {
      console.error(e);
      toast.error(e.response?.data?.message || 'Rejection failed');
    }
  };

  const formatDate = (date) => {
    if (!date) return '-';
    return new Date(date).toLocaleString('en-IN');
  };

  const formatAmount = (amount) => {
    return `₹${Number(amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const getStatusBadge = (status) => {
    const styles = {
      pending: { bg: '#f5c54220', color: '#f5c542' },
      processing: { bg: '#2962ff20', color: '#2962ff' },
      completed: { bg: '#26a69a20', color: '#26a69a' },
      rejected: { bg: '#ef535020', color: '#ef5350' },
      failed: { bg: '#ef535020', color: '#ef5350' },
    };
    const style = styles[status] || styles.pending;
    
    return (
      <span 
        className="px-2 py-1 rounded text-xs font-medium"
        style={{ background: style.bg, color: style.color }}
      >
        {status.toUpperCase()}
      </span>
    );
  };

  return (
    <div className="h-full flex flex-col" style={{ background: '#1e222d' }}>
      <div className="p-4 border-b" style={{ borderColor: '#363a45' }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-bold" style={{ color: '#d1d4dc' }}>
              Admin • Withdrawals
            </div>
            <div className="text-xs mt-1" style={{ color: '#787b86' }}>
              Approve or reject withdrawal requests
            </div>
          </div>
          <button
            onClick={loadWithdrawals}
            className="p-2 rounded-lg flex items-center gap-2 text-sm"
            style={{ background: '#2a2e39', color: '#d1d4dc' }}
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </div>

      {/* Status Filter */}
      <div className="p-3 border-b" style={{ borderColor: '#363a45' }}>
        <div className="flex gap-2">
          {['all', 'pending', 'processing', 'completed', 'rejected'].map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className="px-3 py-2 rounded-lg text-sm font-medium"
              style={{
                background: statusFilter === status ? '#2962ff' : '#2a2e39',
                color: statusFilter === status ? '#fff' : '#787b86',
              }}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Withdrawals List */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="text-center py-8" style={{ color: '#787b86' }}>
            Loading withdrawals...
          </div>
        ) : withdrawals.length === 0 ? (
          <div className="text-center py-8" style={{ color: '#787b86' }}>
            <DollarSign size={48} className="mx-auto mb-3 opacity-30" />
            <div>No {statusFilter === 'all' ? '' : statusFilter} withdrawals found</div>
          </div>
        ) : (
          <div className="space-y-3">
            {withdrawals.map((w) => (
              <div
                key={w.id}
                className="rounded-lg p-4"
                style={{ background: '#2a2e39', border: '1px solid #363a45' }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      {getStatusBadge(w.status)}
                      <span className="text-sm font-bold" style={{ color: '#d1d4dc' }}>
                        {formatAmount(w.amount)}
                      </span>
                    </div>
                    <div className="text-xs" style={{ color: '#787b86' }}>
                      Request ID: {w.reference || w.id.slice(0, 8)}
                    </div>
                  </div>

                  {(w.status === 'pending' || w.status === 'processing') && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => approveWithdrawal(w.id)}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1"
                        style={{ background: '#26a69a20', color: '#26a69a' }}
                      >
                        <CheckCircle size={14} />
                        Approve
                      </button>
                      <button
                        onClick={() => rejectWithdrawal(w.id)}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1"
                        style={{ background: '#ef535020', color: '#ef5350' }}
                      >
                        <XCircle size={14} />
                        Reject
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <div style={{ color: '#787b86' }}>User</div>
                    <div style={{ color: '#d1d4dc' }}>
                      {w.user_name || w.user_email || 'User #' + (w.user_id?.slice(0, 8) || '-')}
                    </div>
                    {w.user_login_id && (
                      <div style={{ color: '#787b86' }}>{w.user_login_id}</div>
                    )}
                  </div>
                  <div>
                    <div style={{ color: '#787b86' }}>Account</div>
                    <div style={{ color: '#d1d4dc' }}>
                      {w.account_number || 'Account #' + (w.account_id?.slice(0, 8) || '-')}
                      {w.is_demo && <span style={{ color: '#f5c542' }}> (Demo)</span>}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#787b86' }}>Method</div>
                    <div style={{ color: '#d1d4dc' }}>{w.payment_method || 'Bank Transfer'}</div>
                  </div>
                  <div>
                    <div style={{ color: '#787b86' }}>Requested</div>
                    <div style={{ color: '#d1d4dc' }}>{formatDate(w.created_at)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}