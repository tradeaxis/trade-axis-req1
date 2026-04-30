import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Clock,
  CheckCircle,
  XCircle,
  RefreshCw,
} from 'lucide-react';

import api from '../../services/api';
import useAuthStore from '../../store/authStore';

const Wallet = ({ selectedAccount, user, intent = 'deposit' }) => {
  const checkAuth = useAuthStore((s) => s.checkAuth);

  const [activeTab, setActiveTab] = useState(intent);
  const [transactions, setTransactions] = useState([]);

  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');

  const [bankDetails, setBankDetails] = useState({
    accountHolderName: '',
    bankName: '',
    accountNumber: '',
    ifscCode: '',
  });

  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoadingTxns, setIsLoadingTxns] = useState(false);

  // Razorpay availability
  const [rzp, setRzp] = useState({ enabled: false, key: null });
  const [qrSettings, setQrSettings] = useState(null);
  const [isLoadingQr, setIsLoadingQr] = useState(false);
  const [qrReference, setQrReference] = useState('');
  const [qrNote, setQrNote] = useState('');

  const isDemo = !!selectedAccount?.is_demo;
  const qrEnabled = !!(
    qrSettings?.enabled &&
    (qrSettings?.qrImage || qrSettings?.upiId || qrSettings?.accountNumber)
  );

  const available = useMemo(
    () => parseFloat(selectedAccount?.free_margin || 0),
    [selectedAccount]
  );

  // ✅ When Settings sends intent=withdraw/deposit, switch tab automatically
  useEffect(() => {
    if (intent === 'deposit' || intent === 'withdraw' || intent === 'history') {
      setActiveTab(intent);
    }
  }, [intent]);

  const fetchTransactions = async () => {
    if (!selectedAccount?.id) return;
    setIsLoadingTxns(true);
    try {
      const res = await api.get(`/transactions?accountId=${selectedAccount.id}&limit=100`);
      setTransactions(res.data.data || []);
    } catch (e) {
      console.error(e);
      toast.error('Failed to fetch transactions');
    } finally {
      setIsLoadingTxns(false);
    }
  };

  const fetchRazorpayKey = async () => {
    try {
      const res = await api.get('/transactions/razorpay-key');
      setRzp({
        enabled: !!res.data?.enabled,
        key: res.data?.key || null,
      });
    } catch (e) {
      setRzp({ enabled: false, key: null });
    }
  };

  const fetchQrSettings = async () => {
    setIsLoadingQr(true);
    try {
      const res = await api.get('/transactions/qr-settings');
      setQrSettings(res.data?.data || res.data?.settings || null);
    } catch (e) {
      console.error(e);
      setQrSettings(null);
    } finally {
      setIsLoadingQr(false);
    }
  };

  useEffect(() => {
    fetchRazorpayKey();
    fetchQrSettings();
  }, []);

  useEffect(() => {
    fetchTransactions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccount?.id]);

  const loadRazorpayScript = () =>
    new Promise((resolve) => {
      const existing = document.getElementById('razorpay-checkout-js');
      if (existing) return resolve(true);

      const script = document.createElement('script');
      script.id = 'razorpay-checkout-js';
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed':
        return <CheckCircle size={16} style={{ color: '#26a69a' }} />;
      case 'pending':
      case 'processing':
        return <Clock size={16} style={{ color: '#ff9800' }} />;
      case 'failed':
      case 'cancelled':
        return <XCircle size={16} style={{ color: '#ef5350' }} />;
      default:
        return <Clock size={16} style={{ color: '#787b86' }} />;
    }
  };

  const handleDeposit = async () => {
    if (!selectedAccount?.id) return toast.error('Select an account first');

    const amount = Number(depositAmount);
    if (!amount || amount < 100) return toast.error('Minimum deposit is ₹100');
    if (amount > 1000000) return toast.error('Maximum deposit is ₹10,00,000');
    if (isDemo) return toast.error('Cannot deposit to demo account');

    setIsProcessing(true);
    try {
      const res = await api.post('/transactions/deposit/create', {
        accountId: selectedAccount.id,
        amount,
      });

      const payload = res.data?.data;

      // MOCK mode
      if (payload?.mock === true) {
        toast.success(`Deposit successful • New balance ₹${Number(payload.newBalance).toFixed(2)}`);
        setDepositAmount('');
        await fetchTransactions();
        await checkAuth();
        return;
      }

      // Razorpay mode
      if (!rzp.enabled || !rzp.key) {
        toast.error('Razorpay not configured. Using mock mode only.');
        return;
      }

      const ok = await loadRazorpayScript();
      if (!ok) {
        toast.error('Razorpay SDK failed to load');
        return;
      }

      const options = {
        key: rzp.key,
        amount: Math.round(amount * 100),
        currency: 'INR',
        name: 'Trade Axis',
        description: 'Deposit to Trading Account',
        order_id: payload.orderId,
        handler: async (response) => {
          try {
            await api.post('/transactions/deposit/verify', {
              orderId: response.razorpay_order_id,
              paymentId: response.razorpay_payment_id,
              signature: response.razorpay_signature,
            });

            toast.success('Deposit successful!');
            setDepositAmount('');
            await fetchTransactions();
            await checkAuth();
          } catch (e) {
            console.error(e);
            toast.error(e.response?.data?.message || 'Payment verification failed');
          }
        },
        prefill: {
          name: `${user?.firstName || ''} ${user?.lastName || ''}`.trim(),
          email: user?.email || '',
          contact: user?.phone || '',
        },
        theme: { color: '#2962ff' },
      };

      // eslint-disable-next-line no-undef
      const rz = new window.Razorpay(options);
      rz.open();
    } catch (e) {
      console.error(e);
      toast.error(e.response?.data?.message || 'Deposit failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleQrDepositRequest = async () => {
    if (!selectedAccount?.id) return toast.error('Select an account first');

    const amount = Number(depositAmount);
    if (!amount || amount < 100) return toast.error('Minimum deposit is INR 100');
    if (amount > 1000000) return toast.error('Maximum deposit is INR 10,00,000');
    if (isDemo) return toast.error('Cannot deposit to demo account');
    if (!qrEnabled) return toast.error('QR deposit is not available right now');
    if (!qrReference.trim()) return toast.error('Enter UTR / payment reference');

    setIsProcessing(true);
    try {
      await api.post('/transactions/qr-deposit-request', {
        accountId: selectedAccount.id,
        amount,
        paymentReference: qrReference.trim(),
        note: qrNote.trim(),
      });

      toast.success('QR deposit request submitted. Admin approval is pending.');
      setDepositAmount('');
      setQrReference('');
      setQrNote('');
      await fetchTransactions();
    } catch (e) {
      console.error(e);
      toast.error(e.response?.data?.message || 'Failed to submit QR deposit request');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleWithdraw = async () => {
    if (!selectedAccount?.id) return toast.error('Select an account first');

    const amount = Number(withdrawAmount);
    if (!amount || amount < 100) return toast.error('Minimum withdrawal is ₹100');
    if (isDemo) return toast.error('Cannot withdraw from demo account');
    if (amount > available) return toast.error(`Insufficient funds. Available ₹${available.toFixed(2)}`);

    if (!bankDetails.accountHolderName.trim()) return toast.error('Account holder name required');
    if (!bankDetails.bankName.trim()) return toast.error('Bank name required');
    if (!bankDetails.accountNumber.trim()) return toast.error('Account number required');
    if (!bankDetails.ifscCode.trim()) return toast.error('IFSC required');

    setIsProcessing(true);
    try {
      await api.post('/transactions/withdraw', {
        accountId: selectedAccount.id,
        amount,
        bankName: bankDetails.bankName,
        accountNumber: bankDetails.accountNumber,
        ifscCode: bankDetails.ifscCode.toUpperCase(),
        accountHolderName: bankDetails.accountHolderName,
      });

      toast.success('Withdrawal request submitted');
      setWithdrawAmount('');
      setBankDetails({ accountHolderName: '', bankName: '', accountNumber: '', ifscCode: '' });

      await fetchTransactions();
      await checkAuth();
    } catch (e) {
      console.error(e);
      toast.error(e.response?.data?.message || 'Withdrawal failed');
    } finally {
      setIsProcessing(false);
    }
  };

  // ✅ If no account selected
  if (!selectedAccount?.id) {
    return (
      <div className="flex flex-col h-full items-center justify-center" style={{ background: '#1e222d', color: '#787b86' }}>
        Please select an account.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ background: '#1e222d' }}>
      {/* Demo banner */}
      {isDemo && (
        <div className="px-4 py-2 text-xs border-b" style={{ borderColor: '#363a45', background: '#2a2e39', color: '#ff9800' }}>
          Demo account: Deposits & withdrawals are disabled.
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b" style={{ borderColor: '#363a45' }}>
        {[
          { id: 'deposit', label: 'Deposit' },
          { id: 'withdraw', label: 'Withdraw' },
          { id: 'history', label: 'History' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className="px-4 py-3 text-sm font-medium border-b-2"
            style={{
              borderColor: activeTab === t.id ? '#2962ff' : 'transparent',
              color: activeTab === t.id ? '#d1d4dc' : '#787b86',
            }}
          >
            {t.label}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2 px-3">
          <button
            onClick={fetchTransactions}
            className="p-2 rounded hover:opacity-80"
            title="Refresh"
            style={{ background: '#2a2e39', color: '#d1d4dc' }}
            disabled={isLoadingTxns}
          >
            <RefreshCw size={16} className={isLoadingTxns ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* Deposit */}
        {activeTab === 'deposit' && (
          <div className="max-w-md mx-auto">
            <div className="mb-3 text-xs" style={{ color: '#787b86' }}>
              <div>
                QR deposit:{' '}
                <span
                  style={{
                    color: qrEnabled ? '#26a69a' : '#787b86',
                    fontWeight: 700,
                  }}
                >
                  {isLoadingQr ? 'Loading...' : qrEnabled ? 'Available' : 'Unavailable'}
                </span>
              </div>
              <div className="mt-1">
                Online deposit:{' '}
                <span
                  style={{
                    color: rzp.enabled ? '#26a69a' : '#787b86',
                    fontWeight: 700,
                  }}
                >
                  {rzp.enabled ? 'Razorpay' : 'Unavailable'}
                </span>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm mb-2" style={{ color: '#787b86' }}>
                Deposit Amount (₹)
              </label>
              <input
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="Enter amount"
                className="w-full px-4 py-3 rounded-lg border text-lg"
                style={{ background: '#2a2e39', borderColor: '#363a45', color: '#d1d4dc' }}
              />
              <div className="grid grid-cols-3 gap-2 mt-2">
                {[500, 1000, 5000, 10000, 25000, 50000].map((amt) => (
                  <button
                    key={amt}
                    onClick={() => setDepositAmount(String(amt))}
                    className="py-2 rounded text-sm"
                    style={{ background: '#2a2e39', color: '#787b86' }}
                  >
                    ₹{amt}
                  </button>
                ))}
              </div>
            </div>

            {/* ✅ NOT faded unless demo/processing */}
            {qrEnabled && (
              <div
                className="mb-4 p-4 rounded-lg border"
                style={{ background: '#2a2e39', borderColor: '#363a45' }}
              >
                <div className="text-sm font-semibold mb-3" style={{ color: '#d1d4dc' }}>
                  Scan QR and pay
                </div>

                {qrSettings?.qrImage && (
                  <div className="mb-3">
                    <img
                      src={qrSettings.qrImage}
                      alt="Deposit QR"
                      className="w-full max-w-xs mx-auto rounded-lg"
                      style={{ border: '1px solid #363a45', background: '#fff' }}
                    />
                  </div>
                )}

                <div className="space-y-1 text-xs" style={{ color: '#d1d4dc' }}>
                  {qrSettings?.upiId && <div>UPI ID: {qrSettings.upiId}</div>}
                  {qrSettings?.accountName && <div>Account Name: {qrSettings.accountName}</div>}
                  {qrSettings?.merchantName && qrSettings?.merchantName !== qrSettings?.accountName && (
                    <div>Merchant: {qrSettings.merchantName}</div>
                  )}
                  {qrSettings?.bankName && <div>Bank: {qrSettings.bankName}</div>}
                  {qrSettings?.accountNumber && <div>Account No: {qrSettings.accountNumber}</div>}
                  {qrSettings?.ifscCode && <div>IFSC: {qrSettings.ifscCode}</div>}
                </div>

                {qrSettings?.instructions && (
                  <div
                    className="mt-3 p-2 rounded text-xs"
                    style={{ background: '#1e222d', color: '#787b86' }}
                  >
                    {qrSettings.instructions}
                  </div>
                )}

                <div className="mt-3 space-y-3">
                  <input
                    type="text"
                    value={qrReference}
                    onChange={(e) => setQrReference(e.target.value)}
                    placeholder="UTR / payment reference"
                    className="w-full px-4 py-3 rounded-lg border text-sm"
                    style={{ background: '#1e222d', borderColor: '#363a45', color: '#d1d4dc' }}
                  />
                  <textarea
                    value={qrNote}
                    onChange={(e) => setQrNote(e.target.value)}
                    placeholder="Optional note"
                    rows={3}
                    className="w-full px-4 py-3 rounded-lg border text-sm resize-none"
                    style={{ background: '#1e222d', borderColor: '#363a45', color: '#d1d4dc' }}
                  />
                </div>

                <button
                  onClick={handleQrDepositRequest}
                  disabled={isProcessing || isDemo}
                  className="w-full py-3 mt-3 rounded-lg font-semibold text-white disabled:opacity-50"
                  style={{ background: '#2962ff' }}
                >
                  {isDemo
                    ? 'QR deposit disabled (Demo)'
                    : isProcessing
                    ? 'Submitting...'
                    : 'Submit QR Deposit Request'}
                </button>

                <div className="text-xs mt-2" style={{ color: '#787b86' }}>
                  Balance is credited only after admin approval.
                </div>
              </div>
            )}

            {rzp.enabled ? (
              <button
                onClick={handleDeposit}
                disabled={isProcessing || isDemo}
                className="w-full py-4 rounded-lg font-semibold text-white text-lg disabled:opacity-50"
                style={{ background: '#26a69a' }}
              >
                {isDemo ? 'Deposit disabled (Demo)' : isProcessing ? 'Processing...' : 'Pay Online'}
              </button>
            ) : (
              <div
                className="p-3 rounded-lg text-sm text-center"
                style={{ background: '#2a2e39', color: '#787b86' }}
              >
                Online deposit is unavailable right now.
              </div>
            )}
          </div>
        )}

        {/* Withdraw */}
        {activeTab === 'withdraw' && (
          <div className="max-w-md mx-auto">
            <div className="mb-4">
              <label className="block text-sm mb-2" style={{ color: '#787b86' }}>
                Withdrawal Amount (₹)
              </label>
              <input
                type="number"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                placeholder="Enter amount"
                className="w-full px-4 py-3 rounded-lg border text-lg"
                style={{ background: '#2a2e39', borderColor: '#363a45', color: '#d1d4dc' }}
              />
              <div className="text-xs mt-1" style={{ color: '#787b86' }}>
                Available: ₹{available.toLocaleString('en-IN')}
              </div>
            </div>

            <div className="space-y-3 mb-4">
              <input
                type="text"
                value={bankDetails.accountHolderName}
                onChange={(e) => setBankDetails((p) => ({ ...p, accountHolderName: e.target.value }))}
                placeholder="Account Holder Name"
                className="w-full px-4 py-2 rounded-lg border text-sm"
                style={{ background: '#2a2e39', borderColor: '#363a45', color: '#d1d4dc' }}
              />
              <input
                type="text"
                value={bankDetails.bankName}
                onChange={(e) => setBankDetails((p) => ({ ...p, bankName: e.target.value }))}
                placeholder="Bank Name"
                className="w-full px-4 py-2 rounded-lg border text-sm"
                style={{ background: '#2a2e39', borderColor: '#363a45', color: '#d1d4dc' }}
              />
              <input
                type="text"
                value={bankDetails.accountNumber}
                onChange={(e) => setBankDetails((p) => ({ ...p, accountNumber: e.target.value }))}
                placeholder="Account Number"
                className="w-full px-4 py-2 rounded-lg border text-sm"
                style={{ background: '#2a2e39', borderColor: '#363a45', color: '#d1d4dc' }}
              />
              <input
                type="text"
                value={bankDetails.ifscCode}
                onChange={(e) => setBankDetails((p) => ({ ...p, ifscCode: e.target.value.toUpperCase() }))}
                placeholder="IFSC Code"
                className="w-full px-4 py-2 rounded-lg border text-sm"
                style={{ background: '#2a2e39', borderColor: '#363a45', color: '#d1d4dc' }}
              />
            </div>

            {/* ✅ NOT faded unless demo/processing */}
            <button
              onClick={handleWithdraw}
              disabled={isProcessing || isDemo}
              className="w-full py-4 rounded-lg font-semibold text-white text-lg disabled:opacity-50"
              style={{ background: '#ef5350' }}
            >
              {isDemo ? 'Withdraw disabled (Demo)' : isProcessing ? 'Processing...' : 'Request Withdrawal'}
            </button>
          </div>
        )}

        {/* History */}
        {activeTab === 'history' && (
          <div className="max-w-2xl mx-auto">
            {transactions.length === 0 ? (
              <div className="text-center py-12" style={{ color: '#787b86' }}>
                No transactions yet
              </div>
            ) : (
              transactions.map((txn) => (
                <div
                  key={txn.id}
                  className="p-3 mb-2 rounded-lg border"
                  style={{ background: '#2a2e39', borderColor: '#363a45' }}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      {txn.transaction_type === 'deposit' ? (
                        <ArrowDownCircle size={20} style={{ color: '#26a69a' }} />
                      ) : (
                        <ArrowUpCircle size={20} style={{ color: '#ef5350' }} />
                      )}
                      <div>
                        <div className="font-semibold" style={{ color: '#d1d4dc' }}>
                          {txn.transaction_type === 'deposit' ? 'Deposit' : 'Withdrawal'}
                        </div>
                        <div className="text-xs" style={{ color: '#787b86' }}>
                          {new Date(txn.created_at).toLocaleString()}
                        </div>
                        <div className="text-xs mt-1" style={{ color: '#787b86' }}>
                          Ref: {txn.reference}
                        </div>
                        {(txn.description || txn.admin_note) && (
                          <div className="text-xs mt-1" style={{ color: '#787b86' }}>
                            {txn.description || txn.admin_note}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="font-bold text-lg" style={{ color: '#d1d4dc' }}>
                        ₹{parseFloat(txn.amount).toLocaleString('en-IN')}
                      </div>
                      <div className="flex items-center gap-1 text-xs mt-1 justify-end">
                        {getStatusIcon(txn.status)}
                        <span style={{ color: '#787b86' }}>{String(txn.status).toUpperCase()}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Wallet;
