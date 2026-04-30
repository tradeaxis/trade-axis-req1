// frontend/src/components/dashboard/HistoryTab.jsx  ── FIXED VERSION
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Clock } from 'lucide-react';
import useTradingStore from '../../store/tradingStore';

const HISTORY_PERIODS = [
  { id: 'today',   label: 'Today' },
  { id: 'week',    label: 'Last Week' },
  { id: 'month',   label: 'Last Month' },
  { id: '3months', label: 'Last 3 Months' },
];

const getPeriodStart = (periodId) => {
  const d = new Date();
  switch (periodId) {
    case 'today':   d.setHours(0, 0, 0, 0); return d;
    case 'week':    d.setDate(d.getDate() - 7); return d;
    case 'month':   d.setMonth(d.getMonth() - 1); return d;
    case '3months': d.setMonth(d.getMonth() - 3); return d;
    default: return null;
  }
};

const inferOriginalQuantity = (trade) => {
  const explicit = Number(trade?.original_quantity);
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }

  const comment = String(trade?.comment || '');
  const partialMatch = comment.match(/partial close:\s*([\d.]+)\s+of\s+([\d.]+)/i);
  if (partialMatch) {
    const parsed = Number(partialMatch[2]);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return Number(trade?.quantity || 0);
};

// ─── Build a grouped "position" from raw closed trade records ────────────────
//
// Backend stores:
//   • Full close   → one 'closed' row with trade_type=original side, quantity=total qty
//   • Partial close → one reduced 'open' row + one 'closed' row with quantity=partialQty
//                     and original_quantity=fullQty at time of partial close
//
// For the History > Positions tab we want to show per original open:
//   Symbol | Buy Qty | Buy Price | Sell Qty | Sell Price | Net | Commission | P&L
//
// Strategy: group closed rows by (symbol, open_time bucket) and derive the sides.
// ─────────────────────────────────────────────────────────────────────────────
function buildPositionGroups(closedTrades) {
  // Sort by close time ascending so we can read partial chains in order
  const sorted = [...closedTrades].sort(
    (a, b) => new Date(a.close_time || 0) - new Date(b.close_time || 0)
  );

  // Group by symbol + open_time (rounded to minute to handle slight timestamp drift)
  const groups = new Map();
  for (const t of sorted) {
    // Use open_time rounded to nearest minute as the group key
    const openMin = t.open_time
      ? new Date(t.open_time).toISOString().slice(0, 16)  // "2026-03-17T13:45"
      : 'unknown';
    const key = `${t.symbol}::${openMin}`;

    if (!groups.has(key)) {
      groups.set(key, {
        id:         t.id,
        symbol:     t.symbol,
        open_time:  t.open_time,
        close_time: t.close_time,
        trades:     [],
      });
    }
    const g = groups.get(key);
    g.trades.push(t);
    // Use latest close_time for the group
    if (!g.close_time || new Date(t.close_time) > new Date(g.close_time)) {
      g.close_time = t.close_time;
    }
  }

  // Compute buy / sell sides for each group
  const result = [];
  for (const g of groups.values()) {
    let buyQty    = 0, buyValue    = 0;
    let sellQty   = 0, sellValue   = 0;
    let totalComm = 0, totalPnL    = 0;

    for (const t of g.trades) {
      const qty       = parseFloat(t.quantity || 0);
      const origQty   = inferOriginalQuantity(t);
      const openPrice = parseFloat(t.open_price  || 0);
      const closePrc  = parseFloat(t.close_price || 0);
      const comm      = parseFloat(t.brokerage   || 0);
      const pnl       = parseFloat(t.profit      || 0);
      totalComm      += comm;
      totalPnL       += pnl;

      // ── FIX: For each closed record:
      //   trade_type == 'buy'  → it was a BUY that got closed (sold)
      //     buy side  = original open qty at open_price
      //     sell side = qty actually closed at close_price
      //
      //   trade_type == 'sell' → it was a SELL that got closed (bought back)
      //     sell side = original open qty at open_price
      //     buy  side = qty actually closed at close_price  (cover)
      // ──────────────────────────────────────────────────────────────
      if (t.trade_type === 'buy') {
        buyQty   += origQty;         // how many shares were open
        buyValue += origQty * openPrice;
        sellQty  += qty;             // how many were closed/sold
        sellValue+= qty * closePrc;
      } else {
        sellQty  += origQty;
        sellValue+= origQty * openPrice;
        buyQty   += qty;             // cover buy
        buyValue += qty * closePrc;
      }
    }

    const avgBuyPrice  = buyQty  > 0 ? buyValue  / buyQty  : 0;
    const avgSellPrice = sellQty > 0 ? sellValue / sellQty : 0;
    // Net = buy qty − sell qty for a long trade, or sell − buy for short
    // In most cases net = 0 when fully closed, but may be nonzero during open partials
    const netQty       = Math.abs(buyQty - sellQty);

    result.push({
      id:           g.id,
      symbol:       g.symbol,
      open_time:    g.open_time,
      close_time:   g.close_time,
      buyQty:       parseFloat(buyQty.toFixed(4)),
      buyPrice:     parseFloat(avgBuyPrice.toFixed(2)),
      sellQty:      parseFloat(sellQty.toFixed(4)),
      sellPrice:    parseFloat(avgSellPrice.toFixed(2)),
      netQty:       parseFloat(netQty.toFixed(4)),
      commission:   parseFloat(totalComm.toFixed(2)),
      profit:       parseFloat(totalPnL.toFixed(2)),
      trades:       g.trades,
    });
  }

  // Latest first
  return result.sort((a, b) => new Date(b.close_time || 0) - new Date(a.close_time || 0));
}

export default function HistoryTab({
  tradeHistory = [],
  deals = [],
  dealsSummary,
  fetchDeals,
  accountId,
  formatINR,
}) {
  const { openTrades } = useTradingStore();

  const [historyPeriod,   setHistoryPeriod]   = useState('month');
  const [historyViewMode, setHistoryViewMode] = useState('positions');
  const [symbolFilter,    setSymbolFilter]    = useState('');
  const [showSymbolDropdown, setShowSymbolDropdown] = useState(false);
  const [expandedGroup,   setExpandedGroup]   = useState(null); // id of expanded position group
  const dropdownRef = useRef(null);

  // ── Symbols currently in open positions (for the "positions only" filter) ──
  const openSymbols = useMemo(
    () => new Set((openTrades || []).map(t => t.symbol)),
    [openTrades]
  );

  useEffect(() => {
    if (!accountId || historyViewMode !== 'deals') return;
    fetchDeals(accountId, historyPeriod);
  }, [accountId, historyViewMode, historyPeriod, fetchDeals]);

  useEffect(() => {
    if (!showSymbolDropdown) return;
    const onDown = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowSymbolDropdown(false);
      }
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [showSymbolDropdown]);

  // ── Filter closed trades by period ──────────────────────────────
  const periodFiltered = useMemo(() => {
    const start = getPeriodStart(historyPeriod);
    let list = tradeHistory || [];
    if (start) {
      list = list.filter(t => {
        const ct = t.close_time || t.closeTime;
        if (!ct) return false;
        return new Date(ct) >= start;
      });
    }
    return list;
  }, [tradeHistory, historyPeriod]);

  // ── Build position groups from period-filtered closed trades ─────
  const positionGroups = useMemo(() => buildPositionGroups(periodFiltered), [periodFiltered]);

  // ── Apply symbol filter (optionally limited to currently open syms) ──
  const filteredGroups = useMemo(() => {
    let list = positionGroups;
    if (symbolFilter) list = list.filter(g => g.symbol === symbolFilter);
    return list;
  }, [positionGroups, symbolFilter]);

  // ── Unique symbols available in dropdown ────────────────────────
  const uniqueSymbols = useMemo(() => {
    const s = new Set((tradeHistory || []).map(t => t.symbol).filter(Boolean));
    return Array.from(s).sort();
  }, [tradeHistory]);

  // ── Summary stats ───────────────────────────────────────────────
  const overallStats = useMemo(() => {
    const totalProfit = filteredGroups
      .filter(g => g.profit > 0)
      .reduce((sum, g) => sum + g.profit, 0);
    const totalLoss = Math.abs(
      filteredGroups.filter(g => g.profit < 0).reduce((sum, g) => sum + g.profit, 0)
    );
    const totalComm = filteredGroups.reduce((sum, g) => sum + g.commission, 0);
    return { count: filteredGroups.length, totalProfit, totalLoss, totalCommission: totalComm };
  }, [filteredGroups]);

  return (
    <div className="flex flex-col h-full" style={{ background: '#1e222d' }}>
      {/* ── Period & mode selector ── */}
      <div className="p-3 border-b" style={{ borderColor: '#363a45' }}>
        <div className="flex gap-1 overflow-x-auto pb-2">
          {HISTORY_PERIODS.map(p => (
            <button
              key={p.id}
              onClick={() => setHistoryPeriod(p.id)}
              className="px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap"
              style={{
                background: historyPeriod === p.id ? '#2962ff' : '#2a2e39',
                color:      historyPeriod === p.id ? '#fff'    : '#787b86',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex gap-2 mt-2">
          {[{ id: 'positions', label: 'Positions' }, { id: 'deals', label: 'Deals' }].map(m => (
            <button
              key={m.id}
              onClick={() => setHistoryViewMode(m.id)}
              className="flex-1 py-2.5 rounded-lg text-sm font-medium"
              style={{
                background: historyViewMode === m.id ? '#2a2e39' : 'transparent',
                color:      historyViewMode === m.id ? '#d1d4dc' : '#787b86',
                border:    `1px solid ${historyViewMode === m.id ? '#363a45' : 'transparent'}`,
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Symbol filter dropdown (positions mode) */}
        {historyViewMode === 'positions' && (
          <div className="mt-2 relative" ref={dropdownRef}>
            <button
              className="w-full px-3 py-2 rounded-lg text-sm text-left flex items-center justify-between"
              style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#d1d4dc' }}
              onClick={e => { e.stopPropagation(); setShowSymbolDropdown(v => !v); }}
            >
              <span>{symbolFilter || 'All Symbols'}</span>
              <ChevronDown size={16} color="#787b86" />
            </button>

            {showSymbolDropdown && (
              <div
                className="absolute top-full left-0 right-0 mt-1 rounded-lg overflow-hidden z-20 max-h-60 overflow-y-auto"
                style={{ background: '#2a2e39', border: '1px solid #363a45' }}
                onClick={e => e.stopPropagation()}
              >
                <button
                  className="w-full px-3 py-2 text-left text-sm hover:bg-white/5"
                  style={{ color: !symbolFilter ? '#2962ff' : '#d1d4dc' }}
                  onClick={() => { setSymbolFilter(''); setShowSymbolDropdown(false); }}
                >
                  All Symbols
                </button>
                {uniqueSymbols.map(sym => (
                  <button
                    key={sym}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-white/5 flex items-center justify-between"
                    style={{ color: symbolFilter === sym ? '#2962ff' : '#d1d4dc' }}
                    onClick={() => { setSymbolFilter(sym); setShowSymbolDropdown(false); }}
                  >
                    <span>{sym}</span>
                    {/* Indicator: symbol has open position */}
                    {openSymbols.has(sym) && (
                      <span
                        className="text-xs px-1.5 py-0.5 rounded"
                        style={{ background: '#2962ff30', color: '#2962ff' }}
                      >
                        Open
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Positions summary bar ── */}
      {historyViewMode === 'positions' && (
        <div
          className="p-3 border-b"
          style={{ borderColor: '#363a45', background: '#252832' }}
        >
          <div className="grid grid-cols-4 gap-2 text-center text-xs">
            <div>
              <div style={{ color: '#787b86' }}>Trades</div>
              <div className="font-bold" style={{ color: '#d1d4dc' }}>{overallStats.count}</div>
            </div>
            <div>
              <div style={{ color: '#787b86' }}>Profit</div>
              <div className="font-bold" style={{ color: '#26a69a' }}>+{formatINR(overallStats.totalProfit)}</div>
            </div>
            <div>
              <div style={{ color: '#787b86' }}>Loss</div>
              <div className="font-bold" style={{ color: '#ef5350' }}>-{formatINR(overallStats.totalLoss)}</div>
            </div>
            <div>
              <div style={{ color: '#787b86' }}>Commission</div>
              <div className="font-bold" style={{ color: '#f5c542' }}>{formatINR(overallStats.totalCommission)}</div>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {/* ──────────────────────────────────────────────────────────
            POSITIONS VIEW
        ────────────────────────────────────────────────────────── */}
        {historyViewMode === 'positions' && (
          <>
            {filteredGroups.length === 0 ? (
              <div className="p-8 text-center" style={{ color: '#787b86' }}>
                <Clock size={48} className="mx-auto mb-3 opacity-30" />
                <div className="text-base">No closed positions</div>
              </div>
            ) : (
              filteredGroups.map(g => {
                const pnl       = g.profit;
                const isExpanded= expandedGroup === g.id;

                return (
                  <div key={g.id} className="border-b" style={{ borderColor: '#363a45' }}>
                    {/* ── Position summary row ── */}
                    <div
                      className="p-3 cursor-pointer hover:bg-white/5"
                      onClick={() => setExpandedGroup(isExpanded ? null : g.id)}
                    >
                      {/* Row 1: Symbol + P&L */}
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="font-bold text-base" style={{ color: '#d1d4dc' }}>{g.symbol}</div>
                          <div className="text-xs mt-0.5" style={{ color: '#787b86' }}>
                            {g.close_time ? new Date(g.close_time).toLocaleString() : ''}
                          </div>
                        </div>
                        <div className="text-right">
                          <div
                            className="font-bold text-lg"
                            style={{ color: pnl >= 0 ? '#26a69a' : '#ef5350' }}
                          >
                            {pnl >= 0 ? '+' : ''}{formatINR(pnl)}
                          </div>
                          <div className="text-xs" style={{ color: '#787b86' }}>
                            Comm: {formatINR(g.commission)}
                          </div>
                        </div>
                      </div>

                      {/* Row 2: Buy | Sell | Net — the key fix */}
                      <div
                        className="mt-2 grid grid-cols-3 gap-1 text-xs rounded-lg p-2"
                        style={{ background: '#1a1e2a' }}
                      >
                        {/* BUY */}
                        <div className="text-center">
                          <div style={{ color: '#787b86' }}>Buy Qty</div>
                          <div className="font-semibold" style={{ color: '#26a69a' }}>
                            {g.buyQty > 0 ? g.buyQty : '—'}
                          </div>
                          {g.buyPrice > 0 && (
                            <div style={{ color: '#787b86' }}>@ {g.buyPrice.toFixed(2)}</div>
                          )}
                        </div>

                        {/* SELL */}
                        <div className="text-center">
                          <div style={{ color: '#787b86' }}>Sell Qty</div>
                          <div className="font-semibold" style={{ color: '#ef5350' }}>
                            {g.sellQty > 0 ? g.sellQty : '—'}
                          </div>
                          {g.sellPrice > 0 && (
                            <div style={{ color: '#787b86' }}>@ {g.sellPrice.toFixed(2)}</div>
                          )}
                        </div>

                        {/* NET */}
                        <div className="text-center">
                          <div style={{ color: '#787b86' }}>Net</div>
                          <div className="font-bold" style={{ color: '#d1d4dc' }}>
                            {g.netQty}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* ── Expanded: individual deal rows ── */}
                    {isExpanded && (
                      <div className="px-3 pb-3">
                        <div className="text-xs mb-1" style={{ color: '#787b86' }}>Individual Deals</div>
                        <div
                          className="rounded-lg overflow-hidden"
                          style={{ border: '1px solid #363a45' }}
                        >
                          {g.trades.map((t, idx) => {
                            const tPnl = parseFloat(t.profit || 0);
                            return (
                              <div
                                key={t.id || idx}
                                className="flex items-center justify-between px-3 py-2 text-xs border-b last:border-0"
                                style={{ borderColor: '#363a45' }}
                              >
                                <div>
                                  <span
                                    className="uppercase font-bold mr-2"
                                    style={{ color: t.trade_type === 'buy' ? '#26a69a' : '#ef5350' }}
                                  >
                                    {t.trade_type}
                                  </span>
                                  <span style={{ color: '#d1d4dc' }}>×{t.quantity}</span>
                                  {t.original_quantity && t.original_quantity !== t.quantity && (
                                    <span style={{ color: '#787b86' }}> (of {t.original_quantity})</span>
                                  )}
                                </div>
                                <div className="text-right" style={{ color: '#787b86' }}>
                                  <div>
                                    {Number(t.open_price || 0).toFixed(2)} → {Number(t.close_price || 0).toFixed(2)}
                                  </div>
                                  <div style={{ color: tPnl >= 0 ? '#26a69a' : '#ef5350' }}>
                                    {tPnl >= 0 ? '+' : ''}{formatINR(tPnl)}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}

        {/* ──────────────────────────────────────────────────────────
            DEALS VIEW
        ────────────────────────────────────────────────────────── */}
        {historyViewMode === 'deals' && (
          <>
            {/* Summary */}
            {dealsSummary && (
              <div
                className="p-3 border-b"
                style={{ borderColor: '#363a45', background: '#252832' }}
              >
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex justify-between">
                    <span style={{ color: '#787b86' }}>Profit:</span>
                    <span style={{ color: '#26a69a' }}>+{formatINR(dealsSummary.totalProfit)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span style={{ color: '#787b86' }}>Loss:</span>
                    <span style={{ color: '#ef5350' }}>-{formatINR(dealsSummary.totalLoss)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span style={{ color: '#787b86' }}>Deposits:</span>
                    <span style={{ color: '#26a69a' }}>+{formatINR(dealsSummary.totalDeposits)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span style={{ color: '#787b86' }}>Withdrawals:</span>
                    <span style={{ color: '#ef5350' }}>-{formatINR(dealsSummary.totalWithdrawals)}</span>
                  </div>
                  <div
                    className="flex justify-between col-span-2 pt-2 border-t"
                    style={{ borderColor: '#363a45' }}
                  >
                    <span style={{ color: '#787b86' }}>Total Commission:</span>
                    <span className="font-bold" style={{ color: '#f5c542' }}>
                      {formatINR(dealsSummary.totalCommission)}
                    </span>
                  </div>
                  {/* Balance line */}
                  {dealsSummary.balance !== undefined && (
                    <div
                      className="flex justify-between col-span-2 pt-2 border-t"
                      style={{ borderColor: '#363a45' }}
                    >
                      <span style={{ color: '#787b86' }}>Balance:</span>
                      <span className="font-bold" style={{ color: '#d1d4dc' }}>
                        {formatINR(dealsSummary.balance)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Deals list */}
            {(!deals || deals.length === 0) ? (
              <div className="p-8 text-center" style={{ color: '#787b86' }}>
                <Clock size={48} className="mx-auto mb-3 opacity-30" />
                <div className="text-base">No deals found</div>
              </div>
            ) : (
              deals.map((d, i) => {
                const pnl    = Number(d.profit || 0);
                const isDeposit = d.type === 'deposit';
                const isWithdrawal = d.type === 'withdrawal';
                const isWeeklySettlement = d.type === 'weekly_settlement';
                const isBalance = d.type === 'balance';

                return (
                  <div key={d.id || i} className="p-3 border-b" style={{ borderColor: '#363a45' }}>
                    <div className="flex items-start justify-between">
                      <div>
                        <div
                          className="font-bold text-sm"
                          style={{
                            color: isDeposit || isWeeklySettlement
                              ? '#26a69a'
                              : isWithdrawal
                              ? '#ef5350'
                              : '#d1d4dc',
                          }}
                        >
                          {d.symbol
                            ? `${d.symbol} — ${String(d.type || d.deal_type || '').toUpperCase()}`
                            : String(d.type || d.deal_type || 'DEAL').toUpperCase()}
                        </div>

                        {/* Qty (buy side qty shown for buys, sell qty for sells) */}
                        {d.quantity && (
                          <div className="text-xs mt-0.5" style={{ color: '#787b86' }}>
                            {d.trade_type
                              ? `${String(d.trade_type).toUpperCase()} × ${d.quantity}`
                              : `Qty: ${d.quantity}`}
                            {d.original_quantity && d.original_quantity !== d.quantity && (
                              <span style={{ color: '#787b86' }}> (of {d.original_quantity})</span>
                            )}
                          </div>
                        )}

                        {/* Time */}
                        <div className="text-xs mt-0.5" style={{ color: '#787b86' }}>
                          {d.close_time || d.created_at
                            ? new Date(d.close_time || d.created_at).toLocaleString()
                            : ''}
                        </div>
                      </div>

                      <div className="text-right">
                        <div
                          className="font-bold"
                          style={{
                            color: pnl >= 0 ? '#26a69a' : '#ef5350',
                            fontSize: 15,
                          }}
                        >
                          {isDeposit || isWeeklySettlement
                            ? `+${formatINR(Math.abs(d.amount || pnl))}`
                            : isWithdrawal
                            ? `-${formatINR(Math.abs(d.amount || pnl))}`
                            : `${pnl >= 0 ? '+' : ''}${formatINR(pnl)}`}
                        </div>

                        {/* Commission */}
                        {d.brokerage > 0 && (
                          <div className="text-xs" style={{ color: '#787b86' }}>
                            Comm: {formatINR(d.brokerage)}
                          </div>
                        )}

                        {/* Balance after deal */}
                        {d.balance_after !== undefined && (
                          <div className="text-xs" style={{ color: '#787b86' }}>
                            Bal: {formatINR(d.balance_after)}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Open → Close price */}
                    {d.open_price && d.close_price && (
                      <div className="flex gap-4 mt-1 text-xs" style={{ color: '#787b86' }}>
                        <span>Open: {Number(d.open_price).toFixed(2)}</span>
                        <span>Close: {Number(d.close_price).toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}
      </div>
    </div>
  );
}
