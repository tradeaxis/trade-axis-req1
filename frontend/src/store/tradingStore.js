// frontend/src/store/tradingStore.js
import { create } from 'zustand';
import api from '../services/api';

const QUOTE_STALE_THRESHOLD_MS = 15000;
const TRADING_CACHE_KEY = 'trade_axis_trading_cache';
const readTradingCache = () => {
  try {
    return JSON.parse(localStorage.getItem(TRADING_CACHE_KEY) || 'null');
  } catch (_) {
    return null;
  }
};

const writeTradingCache = (state) => {
  localStorage.setItem(
    TRADING_CACHE_KEY,
    JSON.stringify({
      openTrades: state.openTrades || [],
      pendingOrders: state.pendingOrders || [],
      pendingOrderHistory: state.pendingOrderHistory || [],
      tradeHistory: state.tradeHistory || [],
      deals: state.deals || [],
      dealsSummary: state.dealsSummary || null,
      lastSyncedAt: state.lastSyncedAt || new Date().toISOString(),
    }),
  );
};

const initialTradingCache = readTradingCache();

const useTradingStore = create((set, get) => ({
  openTrades: initialTradingCache?.openTrades || [],
  pendingOrders: initialTradingCache?.pendingOrders || [],
  pendingOrderHistory: initialTradingCache?.pendingOrderHistory || [],
  tradeHistory: initialTradingCache?.tradeHistory || [],
  deals: initialTradingCache?.deals || [],
  dealsSummary: initialTradingCache?.dealsSummary || null,
  lastSyncedAt: initialTradingCache?.lastSyncedAt || null,
  loading: false,
  error: null,

  fetchOpenTrades: async (accountId) => {
    if (!accountId) return;
    set({ loading: true, error: null });
    try {
      const response = await api.get(`/trading/positions/${accountId}`);
      if (response.data.success) {
        const nextState = {
          openTrades: response.data.data || [],
          loading: false,
          lastSyncedAt: new Date().toISOString(),
        };
        writeTradingCache({ ...get(), ...nextState });
        set(nextState);
      } else {
        set({ error: response.data.message, loading: false });
      }
    } catch (error) {
      console.error('Fetch open trades error:', error);
      set({ error: error.response?.data?.message || 'Failed to fetch positions', loading: false });
    }
  },

  fetchPendingOrders: async (accountId) => {
    if (!accountId) return;
    try {
      const response = await api.get(`/trading/pending-orders/${accountId}`);
      if (response.data.success) {
        const nextState = {
          pendingOrders: response.data.data || [],
          lastSyncedAt: new Date().toISOString(),
        };
        writeTradingCache({ ...get(), ...nextState });
        set(nextState);
      }
    } catch (error) {
      console.error('Fetch pending orders error:', error);
    }
  },

  fetchTradeHistory: async (accountId, filters = {}) => {
    if (!accountId) return;
    set({ loading: true, error: null });
    try {
      const params = new URLSearchParams({ accountId, ...filters });
      const response = await api.get(`/trading/history?${params}`);
      if (response.data.success) {
        const nextState = {
          tradeHistory: response.data.data || [],
          loading: false,
          lastSyncedAt: new Date().toISOString(),
        };
        writeTradingCache({ ...get(), ...nextState });
        set(nextState);
      } else {
        set({ error: response.data.message, loading: false });
      }
    } catch (error) {
      console.error('Fetch trade history error:', error);
      set({ error: error.response?.data?.message || 'Failed to fetch history', loading: false });
    }
  },

  fetchDeals: async (accountId, period = 'month') => {
    if (!accountId) return;
    set({ loading: true, error: null });
    try {
      const response = await api.get(`/transactions/deals?accountId=${accountId}&period=${period}`);
      if (response.data.success) {
        const nextState = {
          deals: response.data.data.deals || [],
          dealsSummary: response.data.data.summary || null,
          loading: false,
          lastSyncedAt: new Date().toISOString(),
        };
        writeTradingCache({ ...get(), ...nextState });
        set(nextState);
      } else {
        set({ error: response.data.message, loading: false });
      }
    } catch (error) {
      console.error('Fetch deals error:', error);
      set({ error: error.response?.data?.message || 'Failed to fetch deals', loading: false });
    }
  },

  fetchPendingOrderHistory: async (accountId) => {
    if (!accountId) return;
    try {
      const response = await api.get(`/trading/pending-order-history/${accountId}`);
      if (response.data.success) {
        const nextState = {
          pendingOrderHistory: response.data.data || [],
          lastSyncedAt: new Date().toISOString(),
        };
        writeTradingCache({ ...get(), ...nextState });
        set(nextState);
      }
    } catch (error) {
      console.error('Fetch pending order history error:', error);
    }
  },

  updateTradePnL: (tradeId, currentPrice, profit) => {
    set((state) => ({
      openTrades: state.openTrades.map((t) =>
        t.id === tradeId ? { ...t, current_price: currentPrice, profit: parseFloat(profit) } : t
      ),
    }));
  },

  updateTradesPnLBatch: (updates) => {
    set((state) => {
      const updatesMap = new Map(updates.map(u => [u.tradeId, u]));
      return {
        openTrades: state.openTrades.map((t) => {
          const update = updatesMap.get(t.id);
          if (update) {
            return { ...t, current_price: update.currentPrice, profit: parseFloat(update.profit) };
          }
          return t;
        }),
      };
    });
  },

  placeOrder: async (orderData) => {
    const {
      accountId, symbol, type, orderType = 'market', quantity,
      price = 0, stopLimitPrice = 0, stopLoss = 0, takeProfit = 0,
      slippage = 3, comment = '', expiration = 'gtc',
      expirationTime = null, magicNumber = 0,
    } = orderData;

    if (!accountId || !symbol || !type || !quantity) {
      return { success: false, message: 'Missing required order parameters' };
    }
    if (quantity <= 0) {
      return { success: false, message: 'Quantity must be greater than 0' };
    }

    // Prevent market orders from using stale quotes.
    const useMarketStore = (await import('./marketStore')).default;
    const isStale = useMarketStore.getState().isQuoteStale(symbol, QUOTE_STALE_THRESHOLD_MS);
    
    if (isStale && (orderType === 'market' || orderType === 'instant')) {
      return {
        success: false,
        code: 'OFF_QUOTES',
        message: `${symbol} is off quotes. Prices have not updated for more than 15 seconds. Please wait for live quotes before placing orders.`,
      };
    }

    set({ loading: true, error: null });

    try {
      const payload = {
        accountId, symbol, type, orderType,
        quantity: parseFloat(quantity),
        price: parseFloat(price) || 0,
        stopLimitPrice: parseFloat(stopLimitPrice) || 0,
        stopLoss: parseFloat(stopLoss) || 0,
        takeProfit: parseFloat(takeProfit) || 0,
        slippage: parseInt(slippage) || 3,
        comment, expiration, expirationTime,
        magicNumber: parseInt(magicNumber) || 0,
      };

      const response = await api.post('/trading/order', payload);

      if (response.data.success) {
        if (response.data.pending) {
          // Pending order (buy_limit, sell_limit, buy_stop, sell_stop)
          await get().fetchPendingOrders(accountId);
        } else {
          // Market order or merged position
          await get().fetchOpenTrades(accountId);
        }
        set({ loading: false });
        return {
          success: true,
          data: response.data.data,
          merged: response.data.merged || false,
          pending: response.data.pending || false,
          message: response.data.message || 'Order placed successfully',
        };
      } else {
        set({ error: response.data.message, loading: false });
        return { success: false, message: response.data.message || 'Order failed' };
      }
    } catch (error) {
      console.error('Place order error:', error);
      const errorMessage = error.response?.data?.message || 'Failed to place order';
      set({ error: errorMessage, loading: false });
      return { success: false, message: errorMessage };
    }
  },

  closeTrade: async (tradeId, accountId, closeQuantity = null) => {
    if (!tradeId) {
      return { success: false, message: 'Missing trade ID' };
    }
    if (!accountId) {
      return { success: false, message: 'Missing account ID. Please select an account.' };
    }

    set({ loading: true, error: null });

    try {
      const response = await api.post(`/trading/close/${tradeId}`, {
        accountId,
        closeQuantity: (closeQuantity && closeQuantity > 0) ? closeQuantity : null,
      });

      if (response.data.success) {
        if (!closeQuantity || response.data.message?.includes('Position closed')) {
          set((state) => ({
            openTrades: state.openTrades.filter((t) => t.id !== tradeId),
            loading: false,
          }));
        }

        await get().fetchOpenTrades(accountId);
        await get().fetchTradeHistory(accountId);

        return { success: true, data: response.data.data, message: response.data.message || 'Position closed successfully' };
      } else {
        set({ error: response.data.message, loading: false });
        return { success: false, message: response.data.message || 'Failed to close position' };
      }
    } catch (error) {
      console.error('Close trade error:', error);
      const errorMessage = error.response?.data?.message || 'Failed to close position';
      set({ error: errorMessage, loading: false });
      return { success: false, message: errorMessage };
    }
  },

  modifyTrade: async (tradeId, modifications) => {
    void tradeId;
    void modifications;
    return {
      success: false,
      message: 'Position modification has been removed. Please close and reopen the trade if changes are needed.',
    };
  },

  addQuantity: async (tradeId, accountId, quantity) => {
    void tradeId;
    void accountId;
    void quantity;
    return {
      success: false,
      message: 'Position add-quantity has been removed. Please place a new trade instead.',
    };
  },

  partialCloseTrade: async (tradeId, accountId, volume) => {
    if (!tradeId || !accountId || !volume) {
      return { success: false, message: 'Missing required parameters' };
    }

    set({ loading: true, error: null });

    try {
      const response = await api.post(`/trading/partial-close/${tradeId}`, {
        accountId, volume: parseFloat(volume),
      });

      if (response.data.success) {
        await get().fetchOpenTrades(accountId);
        set({ loading: false });
        return { success: true, data: response.data.data, message: response.data.message || 'Partial close successful' };
      } else {
        set({ error: response.data.message, loading: false });
        return { success: false, message: response.data.message || 'Failed to partial close' };
      }
    } catch (error) {
      console.error('Partial close error:', error);
      const errorMessage = error.response?.data?.message || 'Failed to partial close';
      set({ error: errorMessage, loading: false });
      return { success: false, message: errorMessage };
    }
  },

  modifyPendingOrder: async (orderId, modifications) => {
    if (!orderId) {
      return { success: false, message: 'Missing order ID' };
    }

    const { price, stopLoss, takeProfit, expiration } = modifications;
    set({ loading: true, error: null });

    try {
      const payload = { price: parseFloat(price) || 0, stopLoss: parseFloat(stopLoss) || 0, takeProfit: parseFloat(takeProfit) || 0, expiration };
      const response = await api.put(`/trading/pending-order/${orderId}`, payload);

      if (response.data.success) {
        set((state) => ({
          pendingOrders: state.pendingOrders.map((o) => o.id === orderId ? { ...o, ...payload } : o),
          loading: false,
        }));
        return { success: true, data: response.data.data, message: response.data.message || 'Order modified successfully' };
      } else {
        set({ error: response.data.message, loading: false });
        return { success: false, message: response.data.message || 'Failed to modify order' };
      }
    } catch (error) {
      console.error('Modify pending order error:', error);
      const errorMessage = error.response?.data?.message || 'Failed to modify order';
      set({ error: errorMessage, loading: false });
      return { success: false, message: errorMessage };
    }
  },

  cancelOrder: async (orderId, accountId) => {
    if (!orderId || !accountId) {
      return { success: false, message: 'Missing order ID or account ID' };
    }

    set({ loading: true, error: null });

    try {
      const response = await api.delete(`/trading/pending-order/${orderId}`, { data: { accountId } });

      if (response.data.success) {
        set((state) => ({
          pendingOrders: state.pendingOrders.filter((o) => o.id !== orderId),
          loading: false,
        }));
        return { success: true, data: response.data.data, message: response.data.message || 'Order cancelled successfully' };
      } else {
        set({ error: response.data.message, loading: false });
        return { success: false, message: response.data.message || 'Failed to cancel order' };
      }
    } catch (error) {
      console.error('Cancel order error:', error);
      const errorMessage = error.response?.data?.message || 'Failed to cancel order';
      set({ error: errorMessage, loading: false });
      return { success: false, message: errorMessage };
    }
  },

  closeAllPositions: async (accountId, filterType = 'all') => {
    if (!accountId) {
      return { success: false, message: 'Missing account ID' };
    }

    const { openTrades } = get();
    if (openTrades.length === 0) {
      return { success: false, message: 'No open positions' };
    }

    let tradesToClose = openTrades;
    if (filterType === 'profitable') {
      tradesToClose = openTrades.filter((t) => parseFloat(t.profit || 0) > 0);
    } else if (filterType === 'losing') {
      tradesToClose = openTrades.filter((t) => parseFloat(t.profit || 0) < 0);
    } else if (filterType === 'buy' || filterType === 'sell') {
      tradesToClose = openTrades.filter((t) => t.trade_type === filterType);
    }

    if (tradesToClose.length === 0) {
      return { success: false, message: `No ${filterType} positions to close` };
    }

    set({ loading: true, error: null });

    try {
      const response = await api.post('/trading/close-all', {
        accountId, filterType, tradeIds: tradesToClose.map((t) => t.id),
      });

      if (response.data.success) {
        await get().fetchOpenTrades(accountId);
        await get().fetchTradeHistory(accountId);
        set({ loading: false });
        return { success: true, data: response.data.data, message: response.data.message || `${tradesToClose.length} position(s) closed successfully` };
      } else {
        set({ error: response.data.message, loading: false });
        return { success: false, message: response.data.message || 'Failed to close positions' };
      }
    } catch (error) {
      console.error('Close all positions error:', error);
      const errorMessage = error.response?.data?.message || 'Failed to close positions';
      set({ error: errorMessage, loading: false });
      return { success: false, message: errorMessage };
    }
  },

  cancelAllOrders: async (accountId) => {
    if (!accountId) {
      return { success: false, message: 'Missing account ID' };
    }

    const { pendingOrders } = get();
    if (pendingOrders.length === 0) {
      return { success: false, message: 'No pending orders' };
    }

    set({ loading: true, error: null });

    try {
      const response = await api.delete('/trading/pending-orders/all', {
        data: { accountId, orderIds: pendingOrders.map((o) => o.id) },
      });

      if (response.data.success) {
        set({ pendingOrders: [], loading: false });
        return { success: true, data: response.data.data, message: response.data.message || `${pendingOrders.length} order(s) cancelled successfully` };
      } else {
        set({ error: response.data.message, loading: false });
        return { success: false, message: response.data.message || 'Failed to cancel orders' };
      }
    } catch (error) {
      console.error('Cancel all orders error:', error);
      const errorMessage = error.response?.data?.message || 'Failed to cancel orders';
      set({ error: errorMessage, loading: false });
      return { success: false, message: errorMessage };
    }
  },

  getTradeById: (tradeId) => {
    const { openTrades } = get();
    return openTrades.find((t) => t.id === tradeId);
  },

  getPendingOrderById: (orderId) => {
    const { pendingOrders } = get();
    return pendingOrders.find((o) => o.id === orderId);
  },

  getTotalPnL: () => {
    const { openTrades } = get();
    return openTrades.reduce((sum, t) => sum + parseFloat(t.profit || 0), 0);
  },

  getPositionsBySymbol: (symbol) => {
    const { openTrades } = get();
    return openTrades.filter((t) => t.symbol === symbol);
  },

  clearError: () => set({ error: null }),

  reset: () => {
    const nextState = {
      openTrades: [],
      pendingOrders: [],
      pendingOrderHistory: [],
      tradeHistory: [],
      deals: [],
      dealsSummary: null,
      lastSyncedAt: null,
      loading: false,
      error: null,
    };
    writeTradingCache(nextState);
    set(nextState);
  },
}));

export default useTradingStore;
