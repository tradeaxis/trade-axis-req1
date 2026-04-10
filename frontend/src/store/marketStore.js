// frontend/src/store/marketStore.js  ── FIXED VERSION
// Key fix: every price update stamps a timestamp so QuotesTab can detect
// symbols that haven't ticked for >10 s and mark them "off quotes".

import { create } from 'zustand';
import api from '../services/api';

const QUOTE_STALE_MS = 10000;
const LIVE_SOURCES = new Set(['kite', 'socket']);

const toTimestamp = (value, fallback = 0) => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const hasPrice = (quote) =>
  Number(quote?.bid || 0) > 0 ||
  Number(quote?.ask || 0) > 0 ||
  Number(quote?.last || quote?.last_price || quote?.lastPrice || 0) > 0;

const isOffQuotes = (quote, timestamp) => {
  if (quote?.off_quotes !== undefined) return !!quote.off_quotes;
  if (!hasPrice(quote)) return true;
  if (!timestamp) return true;
  return Date.now() - timestamp > QUOTE_STALE_MS;
};

const useMarketStore = create((set, get) => ({
  symbols:     [],
  quotes:      {},
  loading:     false,
  error:       null,
  initialized: false,

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
          const timestamp = toTimestamp(s.last_update, 0);
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
            timestamp,
            source:    'db',
            off_quotes:
              !hasPrice(s) ||
              !timestamp ||
              now - timestamp > QUOTE_STALE_MS,
          };
        });

        set({ symbols, quotes, loading: false, error: null, initialized: true });
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
          const source  = item.source || 'socket';
          const isLive  = LIVE_SOURCES.has(source);
          const timestamp = toTimestamp(item.timestamp, now);

          // Always update if source is 'kite' (live tick); skip if same values < 60s
          if (
            !isLive &&
            existing.last === newLast &&
            existing.bid  === newBid  &&
            existing.ask  === newAsk  &&
            existing.timestamp && (now - existing.timestamp < 60000)
          ) continue;

          changed = true;
          const nextQuote = {
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
            timestamp,
            source,
          };
          nextQuote.off_quotes = isLive ? false : isOffQuotes(nextQuote, timestamp);
          newQuotes[sym] = nextQuote;
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
        const source   = data.source || 'socket';
        const isLive   = LIVE_SOURCES.has(source);
        const timestamp = toTimestamp(data.timestamp, now);

        if (
          !isLive &&
          existing.last === newLast &&
          existing.bid  === newBid  &&
          existing.ask  === newAsk  &&
          existing.timestamp && (now - existing.timestamp < 60000)
        ) return {};

        const nextQuote = {
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
          timestamp,
          source,
        };
        nextQuote.off_quotes = isLive ? false : isOffQuotes(nextQuote, timestamp);

        return {
          quotes: {
            ...state.quotes,
            [sym]: nextQuote,
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
    if (existing?.timestamp && !existing?.off_quotes && Date.now() - existing.timestamp < 5000) return existing;

    try {
      const res = await api.get(`/market/quote/${sym}`);
      if (res.data.success && res.data.quote) {
        const q = res.data.quote;
        const timestamp = toTimestamp(q.timestamp, Date.now());
        const source = q.source || 'api';
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
          timestamp,
          source,
          off_quotes:     isOffQuotes(q, timestamp),
        };

        set(state => ({ quotes: { ...state.quotes, [sym]: quote } }));
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

  // ── Utility: is a quote stale? (>10 s without a live tick) ──────
  isQuoteStale: (symbol, thresholdMs = 10000) => {
    if (!symbol) return true;
    const q = get().quotes[String(symbol).toUpperCase()];
    if (!q || !q.timestamp) return true;
    if (q.off_quotes) return true;
    return Date.now() - q.timestamp > thresholdMs;
  },
}));

export default useMarketStore;
