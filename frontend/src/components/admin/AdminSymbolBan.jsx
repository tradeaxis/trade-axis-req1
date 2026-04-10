// frontend/src/components/admin/AdminSymbolBan.jsx  ── NEW FILE
// Admin UI for banning/unbanning individual scripts from trading.
// Usage: import and embed inside AdminPanel.jsx

import { useEffect, useState } from 'react';
import { AlertTriangle, Search, ShieldOff, ShieldCheck } from 'lucide-react';
import { toast } from 'react-hot-toast';
import api from '../../services/api';

export default function AdminSymbolBan() {
  const [symbols,   setSymbols]   = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [search,    setSearch]    = useState('');
  const [banReason, setBanReason] = useState('');
  const [working,   setWorking]   = useState(null); // symbol being toggled

  const fetchSymbols = async () => {
    setLoading(true);
    try {
      const res = await api.get('/market/symbols', { params: { limit: 5000 } });
      if (res.data.success) setSymbols(res.data.symbols || []);
    } catch (err) {
      toast.error('Failed to load symbols');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSymbols(); }, []);

  const filtered = symbols.filter(s => {
    const q = search.toLowerCase();
    return (
      String(s.symbol       || '').toLowerCase().includes(q) ||
      String(s.display_name || '').toLowerCase().includes(q)
    );
  });

  const toggleBan = async (sym) => {
    const isBanned = !sym.is_banned;
    if (isBanned && !banReason.trim()) {
      toast.error('Please enter a ban reason first');
      return;
    }
    setWorking(sym.symbol);
    try {
      const res = await api.post('/admin/symbol-ban', {
        symbol:   sym.symbol,
        isBanned,
        reason:   isBanned ? banReason.trim() : '',
      });
      if (res.data.success) {
        toast.success(res.data.message);
        setBanReason('');
        // Optimistic update
        setSymbols(prev =>
          prev.map(s => s.symbol === sym.symbol
            ? { ...s, is_banned: isBanned, ban_reason: isBanned ? banReason.trim() : '' }
            : s
          )
        );
      } else {
        toast.error(res.data.message || 'Failed');
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error');
    } finally {
      setWorking(null);
    }
  };

  const bannedCount = symbols.filter(s => s.is_banned).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold" style={{ color: '#d1d4dc' }}>Script Ban Management</h2>
          <p className="text-sm" style={{ color: '#787b86' }}>
            {bannedCount} symbol{bannedCount !== 1 ? 's' : ''} currently banned
          </p>
        </div>
        <button
          onClick={fetchSymbols}
          className="px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: '#2962ff', color: '#fff' }}
        >
          Refresh
        </button>
      </div>

      {/* Ban reason input (used for the next ban action) */}
      <div
        className="rounded-xl p-4"
        style={{ background: '#252832', border: '1px solid #363a45' }}
      >
        <label className="block text-sm font-medium mb-2" style={{ color: '#787b86' }}>
          Ban Reason (required when banning a symbol)
        </label>
        <input
          type="text"
          value={banReason}
          onChange={e => setBanReason(e.target.value)}
          placeholder="e.g. Circuit breaker / Admin restriction..."
          className="w-full px-4 py-2 rounded-lg text-sm"
          style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#d1d4dc' }}
        />
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#787b86' }} />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search symbols..."
          className="w-full pl-10 pr-4 py-2.5 rounded-lg text-sm"
          style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#d1d4dc' }}
        />
      </div>

      {/* Symbol list */}
      {loading ? (
        <div className="text-center py-8" style={{ color: '#787b86' }}>Loading symbols...</div>
      ) : (
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: '1px solid #363a45' }}
        >
          {/* Banned symbols first */}
          {[...filtered].sort((a, b) => (b.is_banned ? 1 : 0) - (a.is_banned ? 1 : 0)).map(sym => (
            <div
              key={sym.symbol}
              className="flex items-center justify-between px-4 py-3 border-b"
              style={{
                borderColor: '#363a45',
                background: sym.is_banned ? '#ef535010' : 'transparent',
              }}
            >
              <div className="flex items-center gap-3 min-w-0">
                {sym.is_banned ? (
                  <ShieldOff size={18} color="#ef5350" />
                ) : (
                  <ShieldCheck size={18} color="#26a69a" />
                )}
                <div className="min-w-0">
                  <div className="font-semibold text-sm" style={{ color: sym.is_banned ? '#ef5350' : '#d1d4dc' }}>
                    {sym.symbol}
                  </div>
                  <div className="text-xs truncate" style={{ color: '#787b86' }}>
                    {sym.display_name}
                    {sym.is_banned && sym.ban_reason && (
                      <span className="ml-2" style={{ color: '#ef535090' }}>
                        — {sym.ban_reason}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <button
                onClick={() => toggleBan(sym)}
                disabled={working === sym.symbol}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50 whitespace-nowrap ml-2"
                style={{
                  background: sym.is_banned ? '#26a69a20' : '#ef535020',
                  color:      sym.is_banned ? '#26a69a'   : '#ef5350',
                  border:     `1px solid ${sym.is_banned ? '#26a69a40' : '#ef535040'}`,
                }}
              >
                {working === sym.symbol ? (
                  <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                ) : sym.is_banned ? (
                  <ShieldCheck size={13} />
                ) : (
                  <ShieldOff size={13} />
                )}
                {sym.is_banned ? 'Unban' : 'Ban'}
              </button>
            </div>
          ))}

          {filtered.length === 0 && (
            <div className="p-8 text-center" style={{ color: '#787b86' }}>
              No symbols found
            </div>
          )}
        </div>
      )}
    </div>
  );
}