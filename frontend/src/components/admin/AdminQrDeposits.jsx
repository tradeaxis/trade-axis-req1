import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
  CheckCircle,
  Clock,
  QrCode,
  RefreshCw,
  Save,
  Upload,
  XCircle,
} from 'lucide-react';

import api from '../../services/api';

const defaultSettings = {
  enabled: false,
  qrImage: '',
  upiId: '',
  merchantName: '',
  accountName: '',
  bankName: '',
  accountNumber: '',
  ifscCode: '',
  instructions: '',
};

const normalizeSettings = (payload = {}) => ({
  enabled: !!(payload.enabled ?? payload.isEnabled ?? payload.active),
  qrImage: payload.qrImage || payload.qr_image || payload.qrImageUrl || payload.image || '',
  upiId: payload.upiId || payload.upi_id || '',
  merchantName: payload.merchantName || payload.merchant_name || '',
  accountName: payload.accountName || payload.account_name || payload.accountHolderName || '',
  bankName: payload.bankName || payload.bank_name || '',
  accountNumber: payload.accountNumber || payload.account_number || '',
  ifscCode: payload.ifscCode || payload.ifsc_code || '',
  instructions: payload.instructions || payload.note || payload.notes || '',
});

const formatAmount = (amount) =>
  `INR ${Number(amount || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatDate = (value) => (value ? new Date(value).toLocaleString('en-IN') : '-');

const getStatusBadge = (status) => {
  const normalized = String(status || 'pending').toLowerCase();
  const styles = {
    pending: { bg: '#f5c54220', color: '#f5c542' },
    processing: { bg: '#2962ff20', color: '#2962ff' },
    completed: { bg: '#26a69a20', color: '#26a69a' },
    rejected: { bg: '#ef535020', color: '#ef5350' },
    failed: { bg: '#ef535020', color: '#ef5350' },
  };
  const style = styles[normalized] || styles.pending;
  const label = normalized === 'failed' ? 'rejected' : normalized;

  return (
    <span
      className="px-2 py-1 rounded text-xs font-medium"
      style={{ background: style.bg, color: style.color }}
    >
      {label.toUpperCase()}
    </span>
  );
};

export default function AdminQrDeposits() {
  const [settings, setSettings] = useState(defaultSettings);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [deposits, setDeposits] = useState([]);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [loadingDeposits, setLoadingDeposits] = useState(false);
  const [actionId, setActionId] = useState('');

  const loadSettings = async () => {
    setLoadingSettings(true);
    try {
      const res = await api.get('/admin/qr-settings');
      setSettings(normalizeSettings(res.data?.data || res.data?.settings || {}));
    } catch (e) {
      console.error(e);
      toast.error(e.response?.data?.message || 'Failed to load QR settings');
      setSettings(defaultSettings);
    } finally {
      setLoadingSettings(false);
    }
  };

  const loadDeposits = async () => {
    setLoadingDeposits(true);
    try {
      const res = await api.get(`/admin/qr-deposits?status=${statusFilter}`);
      setDeposits(res.data?.data || res.data?.deposits || []);
    } catch (e) {
      console.error(e);
      toast.error(e.response?.data?.message || 'Failed to load QR deposits');
      setDeposits([]);
    } finally {
      setLoadingDeposits(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    loadDeposits();
  }, [statusFilter]);

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      toast.error('Please use an image smaller than 2 MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setSettings((prev) => ({ ...prev, qrImage: String(reader.result || '') }));
    };
    reader.onerror = () => toast.error('Failed to read image');
    reader.readAsDataURL(file);
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      const payload = {
        enabled: settings.enabled,
        qrImage: settings.qrImage,
        upiId: settings.upiId,
        merchantName: settings.merchantName,
        accountName: settings.accountName,
        bankName: settings.bankName,
        accountNumber: settings.accountNumber,
        ifscCode: settings.ifscCode,
        instructions: settings.instructions,
      };

      const res = await api.post('/admin/qr-settings', payload);
      setSettings(normalizeSettings(res.data?.data || res.data?.settings || payload));
      toast.success(res.data?.message || 'QR settings saved');
    } catch (e) {
      console.error(e);
      toast.error(e.response?.data?.message || 'Failed to save QR settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const approveDeposit = async (id) => {
    if (!window.confirm('Approve this QR deposit request?')) return;
    const adminNote = window.prompt('Approval note (optional):', 'Approved by admin') || 'Approved by admin';

    setActionId(id);
    try {
      await api.post(`/admin/qr-deposits/${id}/approve`, { adminNote });
      toast.success('QR deposit approved');
      await loadDeposits();
    } catch (e) {
      console.error(e);
      toast.error(e.response?.data?.message || 'Approval failed');
    } finally {
      setActionId('');
    }
  };

  const rejectDeposit = async (id) => {
    const adminNote = window.prompt('Rejection reason:', 'Rejected by admin');
    if (adminNote === null) return;

    setActionId(id);
    try {
      await api.post(`/admin/qr-deposits/${id}/reject`, { adminNote: adminNote || 'Rejected by admin' });
      toast.success('QR deposit rejected');
      await loadDeposits();
    } catch (e) {
      console.error(e);
      toast.error(e.response?.data?.message || 'Rejection failed');
    } finally {
      setActionId('');
    }
  };

  return (
    <div className="h-full flex flex-col" style={{ background: '#1e222d' }}>
      <div className="p-4 border-b" style={{ borderColor: '#363a45' }}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-bold" style={{ color: '#d1d4dc' }}>
              Admin - QR Deposits
            </div>
            <div className="text-xs mt-1" style={{ color: '#787b86' }}>
              Upload the deposit QR, review requests, and credit only after approval.
            </div>
          </div>
          <button
            onClick={() => {
              loadSettings();
              loadDeposits();
            }}
            className="p-2 rounded-lg"
            style={{ background: '#2a2e39', color: '#d1d4dc' }}
            disabled={loadingSettings || loadingDeposits}
            title="Refresh QR settings and deposits"
          >
            <RefreshCw
              size={16}
              className={loadingSettings || loadingDeposits ? 'animate-spin' : ''}
            />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div
          className="rounded-xl p-4"
          style={{ background: '#2a2e39', border: '1px solid #363a45' }}
        >
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <QrCode size={20} color="#2962ff" />
              <div className="font-semibold" style={{ color: '#d1d4dc' }}>
                QR Settings
              </div>
            </div>
            <button
              onClick={saveSettings}
              disabled={savingSettings}
              className="px-3 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 flex items-center gap-2"
              style={{ background: '#2962ff' }}
            >
              <Save size={16} />
              {savingSettings ? 'Saving...' : 'Save'}
            </button>
          </div>

          <label className="flex items-center gap-2 text-sm mb-4" style={{ color: '#d1d4dc' }}>
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => setSettings((prev) => ({ ...prev, enabled: e.target.checked }))}
            />
            Enable QR deposit for users
          </label>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs mb-2" style={{ color: '#787b86' }}>
                QR Image
              </label>
              <label
                className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-lg border text-sm cursor-pointer"
                style={{ background: '#1e222d', borderColor: '#363a45', color: '#d1d4dc' }}
              >
                <Upload size={16} />
                Upload QR
                <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
              </label>
              {settings.qrImage && (
                <div className="mt-3">
                  <img
                    src={settings.qrImage}
                    alt="QR preview"
                    className="w-full max-w-xs rounded-lg"
                    style={{ border: '1px solid #363a45', background: '#fff' }}
                  />
                </div>
              )}
            </div>

            <div className="space-y-3">
              <input
                type="text"
                value={settings.upiId}
                onChange={(e) => setSettings((prev) => ({ ...prev, upiId: e.target.value }))}
                placeholder="UPI ID"
                className="w-full px-4 py-3 rounded-lg border text-sm"
                style={{ background: '#1e222d', borderColor: '#363a45', color: '#d1d4dc' }}
              />
              <input
                type="text"
                value={settings.accountName}
                onChange={(e) => setSettings((prev) => ({ ...prev, accountName: e.target.value }))}
                placeholder="Account name"
                className="w-full px-4 py-3 rounded-lg border text-sm"
                style={{ background: '#1e222d', borderColor: '#363a45', color: '#d1d4dc' }}
              />
              <input
                type="text"
                value={settings.merchantName}
                onChange={(e) => setSettings((prev) => ({ ...prev, merchantName: e.target.value }))}
                placeholder="Merchant name"
                className="w-full px-4 py-3 rounded-lg border text-sm"
                style={{ background: '#1e222d', borderColor: '#363a45', color: '#d1d4dc' }}
              />
              <input
                type="text"
                value={settings.bankName}
                onChange={(e) => setSettings((prev) => ({ ...prev, bankName: e.target.value }))}
                placeholder="Bank name"
                className="w-full px-4 py-3 rounded-lg border text-sm"
                style={{ background: '#1e222d', borderColor: '#363a45', color: '#d1d4dc' }}
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  type="text"
                  value={settings.accountNumber}
                  onChange={(e) => setSettings((prev) => ({ ...prev, accountNumber: e.target.value }))}
                  placeholder="Account number"
                  className="w-full px-4 py-3 rounded-lg border text-sm"
                  style={{ background: '#1e222d', borderColor: '#363a45', color: '#d1d4dc' }}
                />
                <input
                  type="text"
                  value={settings.ifscCode}
                  onChange={(e) => setSettings((prev) => ({ ...prev, ifscCode: e.target.value.toUpperCase() }))}
                  placeholder="IFSC code"
                  className="w-full px-4 py-3 rounded-lg border text-sm"
                  style={{ background: '#1e222d', borderColor: '#363a45', color: '#d1d4dc' }}
                />
              </div>
              <textarea
                value={settings.instructions}
                onChange={(e) => setSettings((prev) => ({ ...prev, instructions: e.target.value }))}
                placeholder="Instructions shown to users"
                rows={4}
                className="w-full px-4 py-3 rounded-lg border text-sm resize-none"
                style={{ background: '#1e222d', borderColor: '#363a45', color: '#d1d4dc' }}
              />
            </div>
          </div>
        </div>

        <div
          className="rounded-xl p-4"
          style={{ background: '#2a2e39', border: '1px solid #363a45' }}
        >
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <div className="font-semibold" style={{ color: '#d1d4dc' }}>
                Deposit Requests
              </div>
              <div className="text-xs mt-1" style={{ color: '#787b86' }}>
                Review pending QR payments before crediting user balances.
              </div>
            </div>
            <button
              onClick={loadDeposits}
              className="p-2 rounded-lg"
              style={{ background: '#1e222d', color: '#d1d4dc' }}
              disabled={loadingDeposits}
              title="Refresh QR deposits"
            >
              <RefreshCw size={16} className={loadingDeposits ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="flex gap-2 mb-4 flex-wrap">
            {['all', 'pending', 'completed', 'rejected'].map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className="px-3 py-2 rounded-lg text-sm font-medium"
                style={{
                  background: statusFilter === status ? '#2962ff' : '#1e222d',
                  color: statusFilter === status ? '#ffffff' : '#787b86',
                }}
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </button>
            ))}
          </div>

          {loadingDeposits ? (
            <div className="text-center py-8" style={{ color: '#787b86' }}>
              Loading QR deposits...
            </div>
          ) : deposits.length === 0 ? (
            <div className="text-center py-8" style={{ color: '#787b86' }}>
              <Clock size={40} className="mx-auto mb-3 opacity-30" />
              <div>No {statusFilter === 'all' ? '' : statusFilter} QR deposits found</div>
            </div>
          ) : (
            <div className="space-y-3">
              {deposits.map((deposit) => {
                const isPending = String(deposit.status || '').toLowerCase() === 'pending';
                const isActing = actionId === deposit.id;

                return (
                  <div
                    key={deposit.id}
                    className="rounded-lg p-4"
                    style={{ background: '#1e222d', border: '1px solid #363a45' }}
                  >
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <div className="flex items-center gap-3 mb-1">
                          {getStatusBadge(deposit.status)}
                          <span className="text-sm font-bold" style={{ color: '#d1d4dc' }}>
                            {formatAmount(deposit.amount)}
                          </span>
                        </div>
                        <div className="text-xs" style={{ color: '#787b86' }}>
                          Request ID: {deposit.reference || deposit.id}
                        </div>
                      </div>

                      {isPending && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => approveDeposit(deposit.id)}
                            disabled={isActing}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 disabled:opacity-50"
                            style={{ background: '#26a69a20', color: '#26a69a' }}
                          >
                            <CheckCircle size={14} />
                            Approve
                          </button>
                          <button
                            onClick={() => rejectDeposit(deposit.id)}
                            disabled={isActing}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 disabled:opacity-50"
                            style={{ background: '#ef535020', color: '#ef5350' }}
                          >
                            <XCircle size={14} />
                            Reject
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      <div>
                        <div style={{ color: '#787b86' }}>User</div>
                        <div style={{ color: '#d1d4dc' }}>
                          {deposit.user_name || deposit.user_email || `User ${deposit.user_id?.slice(0, 8) || '-'}`}
                        </div>
                        {deposit.user_login_id && (
                          <div style={{ color: '#787b86' }}>{deposit.user_login_id}</div>
                        )}
                      </div>
                      <div>
                        <div style={{ color: '#787b86' }}>Account</div>
                        <div style={{ color: '#d1d4dc' }}>
                          {deposit.account_number || `Account ${deposit.account_id?.slice(0, 8) || '-'}`}
                          {deposit.is_demo && <span style={{ color: '#f5c542' }}> (Demo)</span>}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: '#787b86' }}>Requested</div>
                        <div style={{ color: '#d1d4dc' }}>{formatDate(deposit.created_at)}</div>
                      </div>
                      <div>
                        <div style={{ color: '#787b86' }}>Processed</div>
                        <div style={{ color: '#d1d4dc' }}>{formatDate(deposit.processed_at)}</div>
                      </div>
                    </div>

                    {deposit.description && (
                      <div className="mt-3 text-xs" style={{ color: '#787b86' }}>
                        {deposit.description}
                      </div>
                    )}
                    {deposit.admin_note && (
                      <div className="mt-2 text-xs" style={{ color: '#787b86' }}>
                        Admin note: {deposit.admin_note}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
