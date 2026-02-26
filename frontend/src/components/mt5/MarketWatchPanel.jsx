import { useMemo, useState } from 'react';
import PanelHeader from './PanelHeader';
import { Search, Plus, Star } from 'lucide-react';

export default function MarketWatchPanel({
  symbols,
  selectedSymbol,
  onSelectSymbol,
  // watchlists
  watchlists,
  activeWatchlistId,
  activeSymbols,
  onSwitchWatchlist,
  onCreateWatchlist,
  onToggleSymbol,
}) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const all = symbols || [];

    // If searching: show all matches (like MT5 “search add”)
    if (search.trim()) {
      const t = search.trim().toLowerCase();
      return all.filter(s =>
        s.symbol.toLowerCase().includes(t) ||
        (s.display_name || '').toLowerCase().includes(t)
      );
    }

    // No search: show only active watchlist symbols
    const wlSet = new Set((activeSymbols || []).map(x => x.toUpperCase()));
    return all.filter(s => wlSet.has(s.symbol.toUpperCase()));
  }, [symbols, search, activeSymbols]);

  return (
    <div className="h-full w-full flex flex-col">
      <PanelHeader
        title="Market Watch"
        right={
          <div className="flex items-center gap-2">
            <select
              value={activeWatchlistId || ''}
              onChange={(e) => onSwitchWatchlist(e.target.value)}
              className="px-2 py-1 rounded text-xs"
              style={{ background: 'var(--mt5-panel)', border: '1px solid var(--mt5-border)' }}
            >
              {(watchlists || []).map(w => (
                <option key={w.id} value={w.id}>
                  {w.name}{w.is_default ? ' (Default)' : ''}
                </option>
              ))}
            </select>
            <button
              onClick={onCreateWatchlist}
              className="w-8 h-8 rounded flex items-center justify-center"
              style={{ background: 'var(--mt5-panel)', border: '1px solid var(--mt5-border)' }}
              title="Create watchlist"
            >
              <Plus size={16} />
            </button>
          </div>
        }
      />

      {/* Search row */}
      <div className="p-2 border-b mt5-border">
        <div className="relative">
          <Search size={14} className="absolute left-2 top-2.5 mt5-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={search ? 'Search symbols...' : 'Search to add symbols...'}
            className="w-full pl-7 pr-2 py-2 rounded text-xs"
            style={{ background: 'var(--mt5-panel)', border: '1px solid var(--mt5-border)' }}
          />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 mt5-panel2">
            <tr className="mt5-muted">
              <th className="text-left px-2 py-2 font-normal w-10"></th>
              <th className="text-left px-2 py-2 font-normal">Symbol</th>
              <th className="text-right px-2 py-2 font-normal">Bid</th>
              <th className="text-right px-2 py-2 font-normal">Ask</th>
              <th className="text-right px-2 py-2 font-normal">Chg%</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => {
              const isSel = s.symbol === selectedSymbol;
              const inWL = (activeSymbols || []).includes(s.symbol.toUpperCase());
              const chg = parseFloat(s.change_percent || 0);

              return (
                <tr
                  key={s.symbol}
                  onClick={() => onSelectSymbol(s.symbol)}
                  className="cursor-pointer border-b mt5-border"
                  style={{ background: isSel ? '#2a3150' : 'transparent' }}
                >
                  <td className="px-2 py-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); onToggleSymbol(s.symbol); }}
                      title={inWL ? 'Remove from watchlist' : 'Add to watchlist'}
                    >
                      <Star size={14} color={inWL ? 'var(--mt5-yellow)' : 'var(--mt5-muted)'} fill={inWL ? 'var(--mt5-yellow)' : 'none'} />
                    </button>
                  </td>
                  <td className="px-2 py-2 font-semibold">{s.symbol}</td>
                  <td className="px-2 py-2 text-right text-loss">{parseFloat(s.bid || s.last_price || 0).toFixed(2)}</td>
                  <td className="px-2 py-2 text-right text-profit">{parseFloat(s.ask || s.last_price || 0).toFixed(2)}</td>
                  <td className={`px-2 py-2 text-right ${chg >= 0 ? 'text-profit' : 'text-loss'}`}>
                    {chg >= 0 ? '+' : ''}{chg.toFixed(2)}
                  </td>
                </tr>
              );
            })}

            {!search.trim() && filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="p-4 text-center mt5-muted">
                  Watchlist empty. Search and click ⭐ to add symbols.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}