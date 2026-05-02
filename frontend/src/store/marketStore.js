// frontend/src/store/marketStore.js  ── FIXED VERSION
// Key fix: every price update stamps a timestamp so QuotesTab can detect
// symbols that haven't ticked for >15 s and mark them "off quotes".

import { create } from 'zustand';
import api from '../services/api';

const QUOTE_STALE_THRESHOLD_MS = 15000;
const MARKET_CACHE_KEY = 'trade_axis_market_cache';
const readMarketCache = () => {
  try {
    return JSON.parse(localStorage.getItem(MARKET_CACHE_KEY) || 'null');
  } catch (_) {
    return null;
  }
};

const writeMarketCache = (state) => {
  localStorage.setItem(
    MARKET_CACHE_KEY,
    JSON.stringify({
      symbols: state.symbols || [],
      quotes: state.quotes || {},
      lastSyncedAt: state.lastSyncedAt || new Date().toISOString(),
    }),
  );
};

const initialMarketCache = readMarketCache();

const useMarketStore = create((set, get) => ({
  symbols:     initialMarketCache?.symbols || [],
  quotes:      initialMarketCache?.quotes || {},
  loading:     false,
  error:       null,
  initialized: false,
  lastSyncedAt: initialMarketCache?.lastSyncedAt || null,

  fetchSymbols: async () => {
    const state = get();
    if (state.loading || state.initialized) return state.symbols;

    try {
      set({ loading: true });
      const res = await api.get('/market/symbols', { params: { limit: 5000 } });

      if (res.data.success) {
        const symbols = res.data.symbols || [];
        const now     = Date.now();

        const quotes = {};
        symbols.forEach(s => {
          quotes[s.symbol] = {
            symbol:         s.symbol,
            bid:            Number(s.bid          || s.last_price  || 0),
            ask:            Number(s.ask          || s.last_price  || 0),
            last:           Number(s.last_price   || 0),
            open:           Number(s.open_price   || s.open  || 0),
            high:           Number(s.high_price   || s.high  || 0),
            low:            Number(s.low_price    || s.low   || 0),
            change:         Number(s.change_value || 0),
            change_percent: Number(s.change_percent || 0),
            volume:         Number(s.volume        || 0),
            display_name:   s.display_name,
            category:       s.category,
            exchange:       s.exchange,
            lot_size:       s.lot_size,
            tick_size:      s.tick_size,
            underlying:     s.underlying,
            expiry_date:    s.expiry_date,
            // ── Use last_update from DB if available, else "now" ──
            // DB prices may be minutes old so we use last_update if present.
            timestamp: s.last_update ? new Date(s.last_update).getTime() : now,
            source:    'db',
          };
        });

        const nextState = {
          symbols,
          quotes,
          loading: false,
          error: null,
          initialized: true,
          lastSyncedAt: new Date().toISOString(),
        };
        writeMarketCache(nextState);
        set(nextState);
        return symbols;
      }

      set({ loading: false, initialized: true });
      return [];
    } catch (error) {
      console.error('fetchSymbols error:', error);
      set({ loading: false, error: error.message, initialized: true });
      return [];
    }
  },

  refreshSymbols: async () => {
    set({ initialized: false, loading: false });
    return get().fetchSymbols();
  },

  // ── Called by socket event handlers to push live price ticks ────
  updatePrice: (data) => {
    if (!data) return;
    const now = Date.now();

    if (Array.isArray(data)) {
      if (data.length === 0) return;

      set(state => {
        const newQuotes = { ...state.quotes };
        let changed = false;

        for (const item of data) {
          if (!item || !item.symbol) continue;
          const sym      = String(item.symbol).toUpperCase();
          const existing = newQuotes[sym] || {};

          const newLast = Number(item.last ?? item.last_price ?? existing.last ?? 0);
          const newBid  = Number(item.bid  ?? existing.bid  ?? 0);
          const newAsk  = Number(item.ask  ?? existing.ask  ?? 0);

          // Always update if source is 'kite' (live tick); skip if same values < 60s
          const isLive = item.source === 'kite' || item.source === 'socket';
          if (
            !isLive &&
            existing.last === newLast &&
            existing.bid  === newBid  &&
            existing.ask  === newAsk  &&
            existing.timestamp && (now - existing.timestamp < 60000)
          ) continue;

          changed = true;
          newQuotes[sym] = {
            ...existing,
            symbol:         sym,
            bid:            newBid,
            ask:            newAsk,
            last:           newLast,
            open:           Number(item.open   ?? existing.open   ?? 0),
            high:           Number(item.high   ?? existing.high   ?? 0),
            low:            Number(item.low    ?? existing.low    ?? 0),
            change:         Number(item.change ?? item.change_value    ?? existing.change         ?? 0),
            change_percent: Number(item.changePercent ?? item.change_percent ?? existing.change_percent ?? 0),
            volume:         Number(item.volume ?? existing.volume  ?? 0),
            // ── Always stamp now so staleness detection works ──
            timestamp: now,
            source:    item.source || 'socket',
          };
        }

        return changed ? { quotes: newQuotes } : {};
      });
      return;
    }

    if (typeof data === 'object' && data.symbol) {
      const sym      = String(data.symbol).toUpperCase();
      const isLive   = data.source === 'kite' || data.source === 'socket';

      set(state => {
        const existing = state.quotes[sym] || {};
        const newLast  = Number(data.last ?? data.last_price ?? existing.last ?? 0);
        const newBid   = Number(data.bid  ?? existing.bid  ?? 0);
        const newAsk   = Number(data.ask  ?? existing.ask  ?? 0);

        if (
          !isLive &&
          existing.last === newLast &&
          existing.bid  === newBid  &&
          existing.ask  === newAsk  &&
          existing.timestamp && (now - existing.timestamp < 60000)
        ) return {};

        return {
          quotes: {
            ...state.quotes,
            [sym]: {
              ...existing,
              symbol:         sym,
              bid:            newBid,
              ask:            newAsk,
              last:           newLast,
              open:           Number(data.open   ?? existing.open   ?? 0),
              high:           Number(data.high   ?? existing.high   ?? 0),
              low:            Number(data.low    ?? existing.low    ?? 0),
              change:         Number(data.change ?? data.change_value    ?? existing.change         ?? 0),
              change_percent: Number(data.changePercent ?? data.change_percent ?? existing.change_percent ?? 0),
              volume:         Number(data.volume ?? existing.volume  ?? 0),
              timestamp: now,
              source:    data.source || 'socket',
            },
          },
        };
      });
    }
  },

  // ── Single-symbol quote fetch (REST fallback) ────────────────────
  getQuote: async (symbol) => {
    if (!symbol) return null;
    const sym      = String(symbol).toUpperCase();
    const existing = get().quotes[sym];

    // Use cached if fresh enough
    if (existing?.timestamp && Date.now() - existing.timestamp < 5000) return existing;

    try {
      const res = await api.get(`/market/quote/${sym}`);
      if (res.data.success && res.data.quote) {
        const q = res.data.quote;
        const quoteTimestamp = q.timestamp
          ? Number(q.timestamp)
          : (q.last_update ? new Date(q.last_update).getTime() : Date.now());
        const quote = {
          symbol:         sym,
          bid:            Number(q.bid        || q.lastPrice || q.last_price || 0),
          ask:            Number(q.ask        || q.lastPrice || q.last_price || 0),
          last:           Number(q.lastPrice  || q.last_price || q.last || 0),
          open:           Number(q.open       || q.open_price || 0),
          high:           Number(q.high       || q.high_price || 0),
          low:            Number(q.low        || q.low_price  || 0),
          change:         Number(q.change     || q.change_value || 0),
          change_percent: Number(q.changePercent || q.change_percent || 0),
          volume:         Number(q.volume     || 0),
          display_name:   q.displayName || q.display_name,
          timestamp:      quoteTimestamp,
          source:         q.source || 'api',
          off_quotes:     Boolean(q.off_quotes),
        };

        const nextState = {
          quotes: { ...get().quotes, [sym]: quote },
          lastSyncedAt: new Date().toISOString(),
        };
        writeMarketCache({ ...get(), ...nextState });
        set(nextState);
        return quote;
      }
    } catch (_) {
      // Silently fall through to cached
    }

    return existing || null;
  },

  getLocalQuote: (symbol) => {
    if (!symbol) return null;
    return get().quotes[String(symbol).toUpperCase()] || null;
  },

  // ── Utility: is a quote stale? (>15 s without a live tick) ──────
  isQuoteStale: (symbol, thresholdMs = QUOTE_STALE_THRESHOLD_MS) => {
    if (!symbol) return true;
    const q = get().quotes[String(symbol).toUpperCase()];
    if (!q || !q.timestamp) return true;
    return Date.now() - q.timestamp > thresholdMs;
  },
}));

export default useMarketStore;
