// frontend/src/store/marketStore.js
import { create } from 'zustand';
import api from '../services/api';

const useMarketStore = create((set, get) => ({
  symbols: [],
  quotes: {},
  loading: false,
  error: null,
  initialized: false,

  fetchSymbols: async () => {
    const state = get();
    if (state.loading || state.initialized) return state.symbols;

    try {
      set({ loading: true });
      const res = await api.get('/market/symbols', { params: { limit: 5000 } });

      if (res.data.success) {
        const symbols = res.data.symbols || [];
        const now = Date.now();

        const quotes = {};
        symbols.forEach((s) => {
          quotes[s.symbol] = {
            symbol: s.symbol,
            bid: Number(s.bid || s.last_price || 0),
            ask: Number(s.ask || s.last_price || 0),
            last: Number(s.last_price || 0),
            open: Number(s.open_price || s.open || 0),
            high: Number(s.high_price || s.high || 0),
            low: Number(s.low_price || s.low || 0),
            change: Number(s.change_value || 0),
            change_percent: Number(s.change_percent || 0),
            volume: Number(s.volume || 0),
            display_name: s.display_name,
            category: s.category,
            exchange: s.exchange,
            lot_size: s.lot_size,
            tick_size: s.tick_size,
            underlying: s.underlying,
            expiry_date: s.expiry_date,
            timestamp: now,
            source: 'db',
            last_update: s.last_update || null,
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
    const store = get();
    return store.fetchSymbols();
  },

  updatePrice: (data) => {
    if (!data) return;

    const now = Date.now();

    if (Array.isArray(data)) {
      if (data.length === 0) return;

      set((state) => {
        const newQuotes = { ...state.quotes };
        let changed = false;

        for (const item of data) {
          if (!item || !item.symbol) continue;
          const sym = String(item.symbol).toUpperCase();
          const existing = newQuotes[sym] || {};

          const newLast = Number(item.last ?? item.last_price ?? existing.last ?? 0);
          const newBid = Number(item.bid ?? existing.bid ?? 0);
          const newAsk = Number(item.ask ?? existing.ask ?? 0);

          // Skip if nothing changed AND we already have a recent timestamp
          if (
            existing.last === newLast &&
            existing.bid === newBid &&
            existing.ask === newAsk &&
            existing.timestamp &&
            (now - existing.timestamp < 60000)
          ) {
            continue;
          }

          changed = true;
          newQuotes[sym] = {
            ...existing,
            symbol: sym,
            bid: newBid,
            ask: newAsk,
            last: newLast,
            open: Number(item.open ?? existing.open ?? 0),
            high: Number(item.high ?? existing.high ?? 0),
            low: Number(item.low ?? existing.low ?? 0),
            change: Number(item.change ?? item.change_value ?? existing.change ?? 0),
            change_percent: Number(item.changePercent ?? item.change_percent ?? existing.change_percent ?? 0),
            volume: Number(item.volume ?? existing.volume ?? 0),
            timestamp: now,
            source: item.source || 'socket',
          };
        }

        return changed ? { quotes: newQuotes } : {};
      });
      return;
    }

    if (typeof data === 'object' && data.symbol) {
      const sym = String(data.symbol).toUpperCase();

      set((state) => {
        const existing = state.quotes[sym] || {};

        const newLast = Number(data.last ?? data.last_price ?? existing.last ?? 0);
        const newBid = Number(data.bid ?? existing.bid ?? 0);
        const newAsk = Number(data.ask ?? existing.ask ?? 0);

        if (
          existing.last === newLast &&
          existing.bid === newBid &&
          existing.ask === newAsk &&
          existing.timestamp &&
          (now - existing.timestamp < 60000)
        ) {
          return {};
        }

        const newQuote = {
          ...existing,
          symbol: sym,
          bid: newBid,
          ask: newAsk,
          last: newLast,
          open: Number(data.open ?? existing.open ?? 0),
          high: Number(data.high ?? existing.high ?? 0),
          low: Number(data.low ?? existing.low ?? 0),
          change: Number(data.change ?? data.change_value ?? existing.change ?? 0),
          change_percent: Number(data.changePercent ?? data.change_percent ?? existing.change_percent ?? 0),
          volume: Number(data.volume ?? existing.volume ?? 0),
          timestamp: now,
          source: data.source || 'socket',
        };

        return {
          quotes: { ...state.quotes, [sym]: newQuote },
        };
      });
    }
  },

  getQuote: async (symbol) => {
    if (!symbol) return null;

    const sym = String(symbol).toUpperCase();
    const existing = get().quotes[sym];

    if (existing?.timestamp && Date.now() - existing.timestamp < 5000) {
      return existing;
    }

    try {
      const res = await api.get(`/market/quote/${sym}`);
      if (res.data.success && res.data.quote) {
        const q = res.data.quote;
        const quote = {
          symbol: sym,
          bid: Number(q.bid || q.lastPrice || q.last_price || 0),
          ask: Number(q.ask || q.lastPrice || q.last_price || 0),
          last: Number(q.lastPrice || q.last_price || q.last || 0),
          open: Number(q.open || q.open_price || 0),
          high: Number(q.high || q.high_price || 0),
          low: Number(q.low || q.low_price || 0),
          change: Number(q.change || q.change_value || 0),
          change_percent: Number(q.changePercent || q.change_percent || 0),
          volume: Number(q.volume || 0),
          display_name: q.displayName || q.display_name,
          timestamp: Date.now(),
          source: q.source || 'api',
          off_quotes: false,
        };

        set((state) => ({
          quotes: { ...state.quotes, [sym]: quote },
        }));

        return quote;
      }
    } catch (error) {
      // Silently fail, use cached
    }

    return existing || null;
  },

  getLocalQuote: (symbol) => {
    if (!symbol) return null;
    return get().quotes[String(symbol).toUpperCase()] || null;
  },
}));

export default useMarketStore;