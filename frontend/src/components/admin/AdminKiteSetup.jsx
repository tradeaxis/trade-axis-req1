// frontend/src/components/admin/AdminKiteSetup.jsx
import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import api from '../../services/api';
import {
  RefreshCw,
  ExternalLink,
  CheckCircle,
  XCircle,
  Play,
  Square,
  Database,
  Wifi,
  WifiOff,
  Clock,
  AlertTriangle,
  Copy,
  Info,
} from 'lucide-react';

export default function AdminKiteSetup() {
  const [status, setStatus] = useState(null);
  const [loginUrl, setLoginUrl] = useState('');
  const [requestToken, setRequestToken] = useState('');
  const [loading, setLoading] = useState({
    status: false,
    loginUrl: false,
    setToken: false,
    sync: false,
    stream: false,
  });

  const fetchStatus = async () => {
    setLoading((prev) => ({ ...prev, status: true }));
    try {
      const res = await api.get('/admin/kite/status');
      setStatus(res.data);
    } catch (error) {
      toast.error('Failed to fetch Kite status');
    } finally {
      setLoading((prev) => ({ ...prev, status: false }));
    }
  };

  useEffect(() => {
    fetchStatus();
    // Refresh status every 30 seconds
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const getLoginUrl = async () => {
    setLoading((prev) => ({ ...prev, loginUrl: true }));
    try {
      const res = await api.get('/admin/kite/login-url');
      if (res.data.success) {
        setLoginUrl(res.data.loginUrl);
      } else {
        toast.error(res.data.message);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to get login URL');
    } finally {
      setLoading((prev) => ({ ...prev, loginUrl: false }));
    }
  };

  const setToken = async () => {
    if (!requestToken.trim()) {
      return toast.error('Please enter the request token');
    }

    setLoading((prev) => ({ ...prev, setToken: true }));
    try {
      const res = await api.post('/admin/kite/create-session', {
        requestToken: requestToken.trim(),
      });

      if (res.data.success) {
        toast.success('Kite session created successfully!');
        setRequestToken('');
        setLoginUrl('');

        // Show stream status from the response (backend already restarted it)
        if (res.data.stream?.started) {
          toast.success(`Stream started with ${res.data.stream.tokens} symbols`);
        } else if (res.data.stream) {
          toast.error(`Stream issue: ${res.data.stream.reason || 'unknown'}`);
        }

        if (res.data.sync?.success && res.data.sync?.upserted > 0) {
          toast.success(`Synced ${res.data.sync.upserted} instruments`);
        }

        // DON'T call start-stream separately — backend already did it in create-session
        fetchStatus();
      } else {
        toast.error(res.data.message);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to create session');
    } finally {
      setLoading((prev) => ({ ...prev, setToken: false }));
    }
  };

  const syncSymbols = async () => {
    setLoading((prev) => ({ ...prev, sync: true }));
    try {
      const res = await api.post('/admin/kite/sync-symbols');
      if (res.data.success) {
        toast.success(res.data.message);
      } else {
        toast.error(res.data.message);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to sync symbols');
    } finally {
      setLoading((prev) => ({ ...prev, sync: false }));
    }
  };

  const toggleStream = async () => {
    setLoading((prev) => ({ ...prev, stream: true }));
    try {
      if (status?.stream?.running) {
        await api.post('/admin/kite/stop-stream');
        toast.success('Stream stopped');
      } else {
        const res = await api.post('/admin/kite/start-stream');
        if (res.data.success) {
          toast.success('Stream started');
        } else {
          toast.error(res.data.message);
        }
      }
      fetchStatus();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to toggle stream');
    } finally {
      setLoading((prev) => ({ ...prev, stream: false }));
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const formatTime = (isoString) => {
    if (!isoString) return 'Never';
    return new Date(isoString).toLocaleString();
  };

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold" style={{ color: '#d1d4dc' }}>
            🔌 Kite Connect Setup
          </h2>
          <p className="text-sm" style={{ color: '#787b86' }}>
            Connect to Zerodha for live market data
          </p>
        </div>
        <button
          onClick={fetchStatus}
          disabled={loading.status}
          className="p-2 rounded-lg"
          style={{ background: '#2a2e39' }}
        >
          <RefreshCw
            size={20}
            color="#787b86"
            className={loading.status ? 'animate-spin' : ''}
          />
        </button>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-2 gap-3">
        {/* API Configured */}
        <div className="p-4 rounded-xl" style={{ background: '#2a2e39' }}>
          <div className="flex items-center gap-2 mb-2">
            {status?.configured ? (
              <CheckCircle size={20} color="#26a69a" />
            ) : (
              <XCircle size={20} color="#ef5350" />
            )}
            <span className="text-sm font-medium" style={{ color: '#d1d4dc' }}>
              API Configured
            </span>
          </div>
          <div className="text-xs" style={{ color: '#787b86' }}>
            {status?.configured
              ? 'API Key & Secret are set in .env'
              : 'Add KITE_API_KEY & KITE_API_SECRET to .env'}
          </div>
        </div>

        {/* Session Ready */}
        <div className="p-4 rounded-xl" style={{ background: '#2a2e39' }}>
          <div className="flex items-center gap-2 mb-2">
            {status?.sessionReady ? (
              <CheckCircle size={20} color="#26a69a" />
            ) : (
              <XCircle size={20} color="#ef5350" />
            )}
            <span className="text-sm font-medium" style={{ color: '#d1d4dc' }}>
              Session Ready
            </span>
          </div>
          <div className="text-xs" style={{ color: '#787b86' }}>
            {status?.sessionReady
              ? `User: ${status?.profile?.userName || 'Connected'}`
              : 'Need to login & set token'}
          </div>
        </div>

        {/* Stream Status */}
        <div className="p-4 rounded-xl" style={{ background: '#2a2e39' }}>
          <div className="flex items-center gap-2 mb-2">
            {status?.stream?.running ? (
              <Wifi size={20} color="#26a69a" />
            ) : (
              <WifiOff size={20} color="#ef5350" />
            )}
            <span className="text-sm font-medium" style={{ color: '#d1d4dc' }}>
              Live Stream
            </span>
          </div>
          <div className="text-xs" style={{ color: '#787b86' }}>
            {status?.stream?.running
              ? `${status?.stream?.tokenCount || 0} symbols streaming`
              : 'Stream not running'}
          </div>
        </div>

        {/* Last Tick */}
        <div className="p-4 rounded-xl" style={{ background: '#2a2e39' }}>
          <div className="flex items-center gap-2 mb-2">
            <Clock size={20} color="#787b86" />
            <span className="text-sm font-medium" style={{ color: '#d1d4dc' }}>
              Last Tick
            </span>
          </div>
          <div className="text-xs" style={{ color: '#787b86' }}>
            {status?.stream?.lastTickAt
              ? formatTime(status.stream.lastTickAt)
              : 'No ticks yet'}
          </div>
        </div>
      </div>

      {/* Setup Steps */}
      <div className="p-4 rounded-xl" style={{ background: '#2a2e39', border: '1px solid #363a45' }}>
        <h3 className="font-bold mb-4" style={{ color: '#d1d4dc' }}>
          Daily Setup (Required before market opens)
        </h3>

        {/* Step 1: Get Login URL */}
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
              style={{ background: '#2962ff', color: '#fff' }}
            >
              1
            </div>
            <span className="text-sm font-medium" style={{ color: '#d1d4dc' }}>
              Get Zerodha Login URL
            </span>
          </div>

          <button
            onClick={getLoginUrl}
            disabled={loading.loginUrl || !status?.configured}
            className="w-full py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: '#2962ff', color: '#fff' }}
          >
            {loading.loginUrl ? (
              <RefreshCw size={16} className="animate-spin" />
            ) : (
              <ExternalLink size={16} />
            )}
            Get Login URL
          </button>

          {loginUrl && (
            <div className="mt-2 p-3 rounded-lg" style={{ background: '#1e222d' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs" style={{ color: '#787b86' }}>
                  Login URL:
                </span>
                <button onClick={() => copyToClipboard(loginUrl)}>
                  <Copy size={14} color="#787b86" />
                </button>
              </div>
              <a
                href={loginUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs break-all hover:underline"
                style={{ color: '#2962ff' }}
              >
                {loginUrl}
              </a>
              <p className="text-xs mt-2" style={{ color: '#f5c542' }}>
                👆 Click above, login to Zerodha, then copy the request_token from the redirect URL
              </p>
            </div>
          )}
        </div>

        {/* Step 2: Enter Request Token */}
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
              style={{ background: '#2962ff', color: '#fff' }}
            >
              2
            </div>
            <span className="text-sm font-medium" style={{ color: '#d1d4dc' }}>
              Enter Request Token
            </span>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={requestToken}
              onChange={(e) => setRequestToken(e.target.value)}
              placeholder="Paste request_token here..."
              className="flex-1 px-3 py-2.5 rounded-lg text-sm"
              style={{
                background: '#1e222d',
                border: '1px solid #363a45',
                color: '#d1d4dc',
              }}
            />
            <button
              onClick={setToken}
              disabled={loading.setToken || !requestToken.trim()}
              className="px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50"
              style={{ background: '#26a69a', color: '#fff' }}
            >
              {loading.setToken ? (
                <RefreshCw size={16} className="animate-spin" />
              ) : (
                <CheckCircle size={16} />
              )}
              Set Token
            </button>
          </div>

          <p className="text-xs mt-2" style={{ color: '#787b86' }}>
            After Zerodha login, URL will look like:
            <br />
            <code style={{ color: '#f5c542' }}>
              https://yourdomain.com?request_token=XXXXXX&action=login&status=success
            </code>
          </p>
        </div>

        {/* Info about token expiry */}
        <div
          className="p-3 rounded-lg flex items-start gap-2"
          style={{ background: '#ff980020', border: '1px solid #ff980050' }}
        >
          <AlertTriangle size={18} color="#ff9800" className="shrink-0 mt-0.5" />
          <div className="text-xs" style={{ color: '#ff9800' }}>
            <strong>Important:</strong> Zerodha access tokens expire daily at 6:00 AM IST.
            You need to repeat this process every trading day before market opens (9:15 AM).
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="grid grid-cols-2 gap-3">
        {/* Sync Symbols */}
        <button
          onClick={syncSymbols}
          disabled={loading.sync || !status?.sessionReady}
          className="p-4 rounded-xl text-left disabled:opacity-50"
          style={{ background: '#2a2e39', border: '1px solid #363a45' }}
        >
          <div className="flex items-center gap-2 mb-2">
            <Database size={20} color="#f5c542" />
            <span className="text-sm font-medium" style={{ color: '#d1d4dc' }}>
              Sync Symbols
            </span>
          </div>
          <div className="text-xs" style={{ color: '#787b86' }}>
            {loading.sync ? 'Syncing...' : 'Update futures contracts from Kite'}
          </div>
        </button>

        {/* Toggle Stream */}
        <button
          onClick={toggleStream}
          disabled={loading.stream || !status?.sessionReady}
          className="p-4 rounded-xl text-left disabled:opacity-50"
          style={{
            background: status?.stream?.running ? '#ef535020' : '#26a69a20',
            border: `1px solid ${status?.stream?.running ? '#ef535050' : '#26a69a50'}`,
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            {status?.stream?.running ? (
              <Square size={20} color="#ef5350" />
            ) : (
              <Play size={20} color="#26a69a" />
            )}
            <span className="text-sm font-medium" style={{ color: '#d1d4dc' }}>
              {status?.stream?.running ? 'Stop Stream' : 'Start Stream'}
            </span>
          </div>
          <div className="text-xs" style={{ color: '#787b86' }}>
            {loading.stream
              ? 'Processing...'
              : status?.stream?.running
              ? 'Click to stop live data'
              : 'Click to start live data'}
          </div>
        </button>
      </div>

      {/* Help Section */}
      <div className="p-4 rounded-xl" style={{ background: '#2a2e39' }}>
        <div className="flex items-start gap-2">
          <Info size={18} color="#2962ff" className="shrink-0 mt-0.5" />
          <div className="text-xs" style={{ color: '#787b86' }}>
            <p className="mb-2">
              <strong style={{ color: '#d1d4dc' }}>How it works:</strong>
            </p>
            <ul className="list-disc list-inside space-y-1">
              <li>Kite stream provides real-time bid/ask prices</li>
              <li>When stream is not running, prices will not update live and symbols may go off quotes</li>
              <li>P&L calculations use the latest prices from the database</li>
              <li>Sync symbols weekly to get new futures contracts</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}