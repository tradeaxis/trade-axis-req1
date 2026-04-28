// frontend/src/components/dashboard/QuotesTab.jsx  ── FIXED VERSION
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart2, ChevronDown, FolderPlus, Plus, Search, Star, TrendingUp, X, WifiOff,
} from 'lucide-react';
import useMarketStore from '../../store/marketStore';

// ── How long (ms) without a price tick before a symbol is considered "off quotes"
const STALE_THRESHOLD_MS = 10_000;

const SYMBOL_CATEGORIES = [
  { id: 'all',               label: 'All' },
  { id: 'index_futures',     label: 'Index Futures' },
  { id: 'stock_futures',     label: 'Stock Futures' },
  { id: 'commodity_futures', label: 'Commodities' },
];

const norm = (v) => String(v || '').toLowerCase().trim();

const inferIndianCategory = (sym) => {
  const c    = norm(sym.category);
  const seg  = norm(sym.segment);
  const inst = norm(sym.instrument_type);
  const name = norm(sym.display_name);
  const s    = String(sym.symbol || '').toUpperCase();

  const looksLikeIndex =
    /NIFTY|SENSEX|BANKNIFTY|FINNIFTY|MIDCPNIFTY/i.test(s) ||
    c.includes('index') || c.includes('indices') ||
    seg.includes('index') || inst.includes('index') ||
    name.includes('nifty') || name.includes('sensex');

  if (looksLikeIndex) return 'index_futures';

  const looksLikeCommodity =
    c.includes('commodity') || seg.includes('commodity') ||
    name.includes('gold') || name.includes('crude') ||
    name.includes('silver') || name.includes('copper') ||
    name.includes('natural gas') || name.includes('aluminium');

  if (looksLikeCommodity) return 'commodity_futures';
  return 'stock_futures';
};

const matchesSelectedCategory = (sym, selectedCategory) =>
  selectedCategory === 'all' || inferIndianCategory(sym) === selectedCategory;

// ── Determine if a quote is stale (no update in >10 s) ──────────
const isStale = (quote) => {
  if (!quote || !quote.timestamp) return true;
  return Date.now() - quote.timestamp > STALE_THRESHOLD_MS;
};

export default function QuotesTab({
  symbols = [],
  selectedSymbol,
  onSelectSymbol,
  watchlists = [],
  activeWatchlistId,
  activeSymbols = [],
  currentWatchlistName,
  onSwitchWatchlist,
  onCreateWatchlist,
  onToggleSymbol,
  onOpenOrderModal,
  onOpenChartTab,
}) {
  const { quotes } = useMarketStore();

  const [selectedCategory, setSelectedCategory] = useState('all');
  const [search, setSearch]  = useState('');
  const searchRef = useRef(null);

  const [showWatchlistMenu, setShowWatchlistMenu] = useState(false);
  const [showSymbolMenu,    setShowSymbolMenu]    = useState(false);
  const [selectedSymbolForAction, setSelectedSymbolForAction] = useState(null);

  // ── Tick counter to force re-renders every 3 s for stale detection ──
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 3000);
    return () => clearInterval(id);
  }, []);

  const filteredSymbols = useMemo(() => {
    // 1. Build a Set of exactly the symbols in the active watchlist
    const wl = new Set((activeSymbols || []).map(s => String(s).toUpperCase()));

    // 2. Start with only symbols that are in the active watchlist
    let list = symbols.filter(s => wl.has(String(s.symbol).toUpperCase()));

    // 3. Apply category filter
    list = list.filter(s => matchesSelectedCategory(s, selectedCategory));

    // 4. Apply search filter
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(s =>
        String(s.symbol).toLowerCase().includes(q) ||
        String(s.display_name || '').toLowerCase().includes(q)
      );
    }

    return list;
  }, [symbols, selectedCategory, search, activeSymbols, tick]);

  // ✅ ADD THIS: Auto-subscribe to visible symbols for live price updates
  useEffect(() => {
    if (!filteredSymbols || filteredSymbols.length === 0) return;
    
    const symbolNames = filteredSymbols.map(s => s.symbol).filter(Boolean);
    if (symbolNames.length > 0) {
      import('../../services/socket').then(({ default: socketService }) => {
        socketService.subscribeSymbols(symbolNames);
        console.log(`📡 Subscribed to ${symbolNames.length} symbols for live prices`);
      });
    }
  }, [filteredSymbols]);

  const openSymbolMenu = (sym) => {
    setSelectedSymbolForAction(sym);
    setShowSymbolMenu(true);
  };

  // ── Symbol action bottom-sheet ──────────────────────────────────
  const SymbolActionMenu = () => {
    if (!showSymbolMenu || !selectedSymbolForAction) return null;
    const sym  = selectedSymbolForAction;
    const inWL = activeSymbols.includes(String(sym.symbol).toUpperCase());
    const q    = quotes[sym.symbol] || {};
    const staleNow = isStale(q);

    return (
      <div
        className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center"
        onClick={() => setShowSymbolMenu(false)}
      >
        <div
          className="w-full max-w-lg rounded-t-xl p-4"
          style={{ background: '#1e222d', border: '1px solid #363a45' }}
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="flex items-center gap-2 font-bold text-xl" style={{ color: '#d1d4dc' }}>
                {sym.symbol}
                {staleNow && (
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#363a45', color: '#787b86' }}>
                    Off Quotes
                  </span>
                )}
              </div>
              <div className="text-sm" style={{ color: '#787b86' }}>{sym.display_name}</div>
            </div>
            <button onClick={() => setShowSymbolMenu(false)}>
              <X size={22} color="#787b86" />
            </button>
          </div>

          <div className="space-y-2">
            {/* New Order — disabled when off quotes */}
            <button
              onClick={() => {
                if (staleNow) return;
                onSelectSymbol(sym.symbol);
                setShowSymbolMenu(false);
                onOpenOrderModal();
              }}
              disabled={staleNow}
              className="w-full py-3 rounded-lg font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: '#2962ff' }}
              title={staleNow ? 'Symbol is off quotes — cannot place order' : ''}
            >
              <TrendingUp size={18} />
              {staleNow ? 'Off Quotes — Cannot Order' : 'New Order'}
            </button>

            <button
              onClick={() => {
                onSelectSymbol(sym.symbol);
                setShowSymbolMenu(false);
                onOpenChartTab();
              }}
              className="w-full py-3 rounded-lg font-medium flex items-center justify-center gap-2"
              style={{ background: '#2a2e39', color: '#d1d4dc', border: '1px solid #363a45' }}
            >
              <BarChart2 size={18} />
              Chart
            </button>

            <button
              onClick={() => {
                onToggleSymbol(sym.symbol);
                setShowSymbolMenu(false);
              }}
              className="w-full py-3 rounded-lg font-medium"
              style={{ background: '#2a2e39', color: '#d1d4dc', border: '1px solid #363a45' }}
            >
              {inWL ? 'Remove from Watchlist' : 'Add to Watchlist'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── Watchlist bottom-sheet ──────────────────────────────────────
  const WatchlistMenu = () => {
    if (!showWatchlistMenu) return null;
    return (
      <div
        className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center"
        onClick={() => setShowWatchlistMenu(false)}
      >
        <div
          className="w-full max-w-lg rounded-t-xl"
          style={{ background: '#1e222d', border: '1px solid #363a45' }}
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: '#363a45' }}>
            <div className="font-bold text-lg" style={{ color: '#d1d4dc' }}>Watchlists</div>
            <button onClick={() => setShowWatchlistMenu(false)}>
              <X size={22} color="#787b86" />
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {watchlists.map(wl => (
              <button
                key={wl.id}
                className="w-full p-4 text-left border-b hover:bg-white/5"
                style={{
                  borderColor: '#363a45',
                  background: wl.id === activeWatchlistId ? '#2962ff20' : 'transparent',
                  color: '#d1d4dc',
                }}
                onClick={e => {
                  e.stopPropagation();
                  onSwitchWatchlist(wl.id);
                  setShowWatchlistMenu(false);
                }}
              >
                {wl.name}
              </button>
            ))}
          </div>

          <div className="p-4 border-t" style={{ borderColor: '#363a45' }}>
            <button
              onClick={e => {
                e.stopPropagation();
                setShowWatchlistMenu(false);
                onCreateWatchlist();
              }}
              className="w-full py-3 rounded-lg font-semibold text-white flex items-center justify-center gap-2"
              style={{ background: '#2962ff' }}
            >
              <FolderPlus size={18} />
              Create Watchlist
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full" style={{ background: '#1e222d' }}>
      {/* ── Header ── */}
      <div className="p-3 border-b" style={{ borderColor: '#363a45' }}>
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => setShowWatchlistMenu(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg"
            style={{ background: '#2a2e39', border: '1px solid #363a45' }}
          >
            <Star size={16} color="#f5c542" />
            <span className="font-medium" style={{ color: '#d1d4dc' }}>
              {currentWatchlistName || 'Select Watchlist'}
            </span>
            <ChevronDown size={16} color="#787b86" />
          </button>

          <button
            onClick={onCreateWatchlist}
            className="p-2 rounded-lg"
            style={{ background: '#2962ff' }}
            title="Create Watchlist"
          >
            <Plus size={18} color="#fff" />
          </button>
        </div>

        {/* Category filter */}
        <div className="flex gap-1 overflow-x-auto pb-2">
          {SYMBOL_CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className="px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap"
              style={{
                background: selectedCategory === cat.id ? '#2962ff' : '#2a2e39',
                color:      selectedCategory === cat.id ? '#fff'    : '#787b86',
              }}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative mt-2">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#787b86' }} />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search symbols..."
            className="w-full pl-10 pr-10 py-2.5 rounded border text-base"
            style={{ background: '#2a2e39', borderColor: '#363a45', color: '#d1d4dc' }}
            autoComplete="off"
          />
          {search && (
            <button
              onClick={() => { setSearch(''); searchRef.current?.focus(); }}
              className="absolute right-3 top-1/2 -translate-y-1/2"
            >
              <X size={16} color="#787b86" />
            </button>
          )}
        </div>
      </div>

      {/* ── Column headers ── */}
      <div
        className="grid px-3 py-1 text-xs"
        style={{
          gridTemplateColumns: '1fr auto auto auto',
          color: '#787b86',
          borderBottom: '1px solid #363a45',
          background: '#1a1e2a',
        }}
      >
        <div>Symbol</div>
        <div className="text-right pr-3" style={{ minWidth: 72 }}>Bid</div>
        <div className="text-right" style={{ minWidth: 72 }}>Ask</div>
      </div>

      {/* ── Symbol list ── */}
      <div className="flex-1 overflow-y-auto">
        {filteredSymbols.length === 0 ? (
          <div className="p-6 text-center text-base" style={{ color: '#787b86' }}>
            {search ? 'No symbols found' : 'Watchlist is empty'}
          </div>
        ) : (
          filteredSymbols.map(sym => {
            const isSelected = selectedSymbol === sym.symbol;
            const inWL       = activeSymbols.includes(String(sym.symbol).toUpperCase());
            const q          = quotes[sym.symbol] || {};
            const staleNow   = isStale(q);

            // Prices
            const bid    = Number(q.bid  || sym.bid  || sym.last_price || 0);
            const ask    = Number(q.ask  || sym.ask  || sym.last_price || 0);
            const high   = Number(q.high || sym.high_price || sym.high || 0);
            const low    = Number(q.low  || sym.low_price  || sym.low  || 0);
            const chgPct = Number(q.change_percent ?? q.changePct ?? sym.change_percent ?? 0);

            // Colour scheme when stale: grey everything
            const priceColor = staleNow ? '#787b86' : undefined;
            const bidColor   = staleNow ? '#787b86' : '#ef5350';
            const askColor   = staleNow ? '#787b86' : '#26a69a';
            const symColor   = staleNow ? '#787b86' : '#d1d4dc';

            return (
              <div
                key={sym.symbol}
                onClick={() => {
                  onSelectSymbol(sym.symbol);
                  openSymbolMenu(sym);
                }}
                className="cursor-pointer hover:bg-white/5 border-b"
                style={{
                  background:  isSelected ? '#2a2e39' : staleNow ? '#1a1c24' : 'transparent',
                  borderColor: '#363a45',
                  borderLeft:  isSelected ? '3px solid #2962ff' : '3px solid transparent',
                  opacity:     staleNow ? 0.65 : 1,
                }}
              >
                {/* ── Row: symbol name + bid + ask ── */}
                <div
                  className="grid px-3 py-2 items-center"
                  style={{ gridTemplateColumns: '1fr auto auto' }}
                >
                  {/* Symbol name column */}
                  <div className="flex items-center gap-2 min-w-0">
                    <Star
                      size={12}
                      color={inWL ? '#f5c542' : '#787b86'}
                      fill={inWL  ? '#f5c542' : 'none'}
                    />
                    <div className="min-w-0">
                      <div
                        className="font-semibold truncate"
                        style={{ fontSize: 14, color: symColor, lineHeight: 1.2 }}
                      >
                        {sym.symbol}
                      </div>
                      <div className="text-xs truncate" style={{ color: '#787b86', lineHeight: 1.2 }}>
                        {sym.display_name}
                      </div>
                    </div>
                    {staleNow && (
                      <WifiOff size={12} color="#787b86" title="Off quotes — no price update" />
                    )}
                  </div>

                  {/* Bid */}
                  <div
                    className="text-right font-mono px-3"
                    style={{ minWidth: 72, fontSize: 14, color: bidColor }}
                  >
                    {bid > 0 ? bid.toFixed(2) : '—'}
                  </div>

                  {/* Ask */}
                  <div
                    className="text-right font-mono"
                    style={{ minWidth: 72, fontSize: 14, color: askColor }}
                  >
                    {ask > 0 ? ask.toFixed(2) : '—'}
                  </div>
                </div>

                {/* ── Sub-row: High / Low — same horizontal line ── */}
                <div
                  className="flex items-center gap-4 px-3 pb-1.5"
                  style={{ fontSize: 11, color: priceColor || '#787b86' }}
                >
                  <span>
                    H:&nbsp;
                    <span style={{ color: priceColor || '#26a69a' }}>
                      {high > 0 ? high.toFixed(2) : '—'}
                    </span>
                  </span>
                  <span>
                    L:&nbsp;
                    <span style={{ color: priceColor || '#ef5350' }}>
                      {low > 0 ? low.toFixed(2) : '—'}
                    </span>
                  </span>
                  {!staleNow && (
                    <span
                      className="ml-auto"
                      style={{ color: chgPct >= 0 ? '#26a69a' : '#ef5350' }}
                    >
                      {chgPct >= 0 ? '+' : ''}{chgPct.toFixed(2)}%
                    </span>
                  )}
                  {staleNow && (
                    <span className="ml-auto" style={{ color: '#787b86', fontSize: 10 }}>
                      Off Quotes
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <SymbolActionMenu />
      <WatchlistMenu />
    </div>
  );
}