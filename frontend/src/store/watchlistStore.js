// frontend/src/store/watchlistStore.js
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import api from '../services/api';

const useWatchlistStore = create(
  persist(
    (set, get) => ({
      // ============ STATE ============
      watchlists: [],
      activeWatchlistId: null,
      activeSymbols: [],
      loading: false,
      error: null,

      // Symbol ordering/arrangement
      symbolOrder: {}, // { watchlistId: ['SYM1', 'SYM2', ...] }

      // Recently viewed symbols
      recentSymbols: [],
      maxRecentSymbols: 10,

      // ============ FETCH WATCHLISTS ============
      fetchWatchlists: async () => {
        set({ loading: true, error: null });

        try {
          const response = await api.get('/watchlists');

          if (response.data.success) {
            const watchlists = response.data.data || [];
            set({ watchlists, loading: false });
            return watchlists;
          } else {
            set({ error: response.data.message, loading: false });
            return [];
          }
        } catch (error) {
          console.error('Fetch watchlists error:', error);
          set({
            error: error.response?.data?.message || 'Failed to fetch watchlists',
            loading: false,
          });
          return [];
        }
      },

      // ============ CREATE WATCHLIST ============
      createWatchlist: async (name, isDefault = false) => {
        if (!name || !name.trim()) {
          return { success: false, message: 'Watchlist name is required' };
        }

        set({ loading: true, error: null });

        try {
          const response = await api.post('/watchlists', {
            name: name.trim(),
            isDefault,
          });

          if (response.data.success) {
            const newWatchlist = response.data.data;

            set((state) => ({
              watchlists: [...state.watchlists, newWatchlist],
              loading: false,
            }));

            return newWatchlist;
          } else {
            set({ error: response.data.message, loading: false });
            throw new Error(response.data.message);
          }
        } catch (error) {
          console.error('Create watchlist error:', error);
          const errorMessage =
            error.response?.data?.message || 'Failed to create watchlist';
          set({ error: errorMessage, loading: false });
          throw new Error(errorMessage);
        }
      },

      // ============ RENAME WATCHLIST ============
      renameWatchlist: async (watchlistId, newName) => {
        if (!watchlistId) {
          return { success: false, message: 'Watchlist ID is required' };
        }

        if (!newName || !newName.trim()) {
          return { success: false, message: 'New name is required' };
        }

        set({ loading: true, error: null });

        try {
          const response = await api.put(`/watchlists/${watchlistId}`, {
            name: newName.trim(),
          });

          if (response.data.success) {
            set((state) => ({
              watchlists: state.watchlists.map((w) =>
                w.id === watchlistId ? { ...w, name: newName.trim() } : w
              ),
              loading: false,
            }));

            return { success: true, message: 'Watchlist renamed successfully' };
          } else {
            set({ error: response.data.message, loading: false });
            return { success: false, message: response.data.message };
          }
        } catch (error) {
          console.error('Rename watchlist error:', error);
          const errorMessage =
            error.response?.data?.message || 'Failed to rename watchlist';
          set({ error: errorMessage, loading: false });
          return { success: false, message: errorMessage };
        }
      },

      // ============ DELETE WATCHLIST ============
      deleteWatchlist: async (watchlistId) => {
        if (!watchlistId) {
          return { success: false, message: 'Watchlist ID is required' };
        }

        const { watchlists, activeWatchlistId } = get();
        const watchlistToDelete = watchlists.find((w) => w.id === watchlistId);

        // Prevent deleting default watchlist
        if (watchlistToDelete?.is_default) {
          return { success: false, message: 'Cannot delete default watchlist' };
        }

        // Prevent deleting if it's the only watchlist
        if (watchlists.length <= 1) {
          return { success: false, message: 'Cannot delete the only watchlist' };
        }

        set({ loading: true, error: null });

        try {
          const response = await api.delete(`/watchlists/${watchlistId}`);

          if (response.data.success) {
            // Remove from state
            const newWatchlists = watchlists.filter((w) => w.id !== watchlistId);

            // If we deleted the active watchlist, switch to default or first
            let newActiveId = activeWatchlistId;
            let newActiveSymbols = get().activeSymbols;

            if (activeWatchlistId === watchlistId) {
              const defaultWatchlist = newWatchlists.find((w) => w.is_default);
              newActiveId = defaultWatchlist?.id || newWatchlists[0]?.id || null;
              newActiveSymbols = [];
            }

            set({
              watchlists: newWatchlists,
              activeWatchlistId: newActiveId,
              activeSymbols: newActiveSymbols,
              loading: false,
            });

            // Fetch symbols for new active watchlist
            if (newActiveId && activeWatchlistId === watchlistId) {
              get().fetchWatchlistSymbols(newActiveId);
            }

            return { success: true, message: 'Watchlist deleted successfully' };
          } else {
            set({ error: response.data.message, loading: false });
            return { success: false, message: response.data.message };
          }
        } catch (error) {
          console.error('Delete watchlist error:', error);
          const errorMessage =
            error.response?.data?.message || 'Failed to delete watchlist';
          set({ error: errorMessage, loading: false });
          return { success: false, message: errorMessage };
        }
      },

      // ============ SET DEFAULT WATCHLIST ============
      setDefaultWatchlist: async (watchlistId) => {
        if (!watchlistId) {
          return { success: false, message: 'Watchlist ID is required' };
        }

        set({ loading: true, error: null });

        try {
          const response = await api.put(`/watchlists/${watchlistId}/set-default`);

          if (response.data.success) {
            set((state) => ({
              watchlists: state.watchlists.map((w) => ({
                ...w,
                is_default: w.id === watchlistId,
              })),
              loading: false,
            }));

            return { success: true, message: 'Default watchlist updated' };
          } else {
            set({ error: response.data.message, loading: false });
            return { success: false, message: response.data.message };
          }
        } catch (error) {
          console.error('Set default watchlist error:', error);
          const errorMessage =
            error.response?.data?.message || 'Failed to set default watchlist';
          set({ error: errorMessage, loading: false });
          return { success: false, message: errorMessage };
        }
      },

      // ============ DUPLICATE WATCHLIST ============
      duplicateWatchlist: async (watchlistId, newName) => {
        const { watchlists, activeSymbols } = get();
        const original = watchlists.find((w) => w.id === watchlistId);

        if (!original) {
          return { success: false, message: 'Watchlist not found' };
        }

        try {
          // Create new watchlist
          const newWatchlist = await get().createWatchlist(
            newName || `${original.name} (Copy)`,
            false
          );

          // Get symbols from original
          let symbolsToCopy = activeSymbols;
          if (watchlistId !== get().activeWatchlistId) {
            // Fetch symbols from the original watchlist
            const response = await api.get(`/watchlists/${watchlistId}/symbols`);
            symbolsToCopy = response.data.data?.map((s) => s.symbol) || [];
          }

          // Add symbols to new watchlist
          for (const symbol of symbolsToCopy) {
            await get().addSymbol(newWatchlist.id, symbol);
          }

          return {
            success: true,
            data: newWatchlist,
            message: 'Watchlist duplicated successfully',
          };
        } catch (error) {
          console.error('Duplicate watchlist error:', error);
          return { success: false, message: 'Failed to duplicate watchlist' };
        }
      },

      // ============ FETCH WATCHLIST SYMBOLS ============
      fetchWatchlistSymbols: async (watchlistId) => {
        if (!watchlistId) {
          set({ activeSymbols: [] });
          return [];
        }

        set({ loading: true, error: null });

        try {
          const response = await api.get(`/watchlists/${watchlistId}/symbols`);

          if (response.data.success) {
            const symbols = response.data.data?.map((s) => s.symbol) || [];

            // Respect custom order if exists
            const { symbolOrder } = get();
            const order = symbolOrder[watchlistId];
            let orderedSymbols = symbols;

            if (order && order.length > 0) {
              // Sort by custom order, keep new symbols at end
              const orderMap = new Map(order.map((s, i) => [s, i]));
              orderedSymbols = [...symbols].sort((a, b) => {
                const orderA = orderMap.has(a) ? orderMap.get(a) : Infinity;
                const orderB = orderMap.has(b) ? orderMap.get(b) : Infinity;
                return orderA - orderB;
              });
            }

            set({ activeSymbols: orderedSymbols, loading: false });
            return orderedSymbols;
          } else {
            set({ activeSymbols: [], error: response.data.message, loading: false });
            return [];
          }
        } catch (error) {
          console.error('Fetch watchlist symbols error:', error);
          set({
            activeSymbols: [],
            error: error.response?.data?.message || 'Failed to fetch symbols',
            loading: false,
          });
          return [];
        }
      },

      // ============ ADD SYMBOL ============
      addSymbol: async (watchlistId, symbol) => {
        if (!watchlistId || !symbol) {
          return { success: false, message: 'Watchlist ID and symbol are required' };
        }

        const normalizedSymbol = symbol.toUpperCase().trim();
        const { activeSymbols, activeWatchlistId } = get();

        // Check if already exists
        if (
          watchlistId === activeWatchlistId &&
          activeSymbols.includes(normalizedSymbol)
        ) {
          return { success: false, message: 'Symbol already in watchlist' };
        }

        try {
          const response = await api.post(`/watchlists/${watchlistId}/symbols`, {
            symbol: normalizedSymbol,
          });

          if (response.data.success) {
            // Update state if this is the active watchlist
            if (watchlistId === activeWatchlistId) {
              set((state) => ({
                activeSymbols: [...state.activeSymbols, normalizedSymbol],
              }));
            }

            return { success: true, message: 'Symbol added successfully' };
          } else {
            return { success: false, message: response.data.message };
          }
        } catch (error) {
          console.error('Add symbol error:', error);
          return {
            success: false,
            message: error.response?.data?.message || 'Failed to add symbol',
          };
        }
      },

      // ============ REMOVE SYMBOL ============
      removeSymbol: async (watchlistId, symbol) => {
        if (!watchlistId || !symbol) {
          return { success: false, message: 'Watchlist ID and symbol are required' };
        }

        const normalizedSymbol = symbol.toUpperCase().trim();

        try {
          const response = await api.delete(
            `/watchlists/${watchlistId}/symbols/${normalizedSymbol}`
          );

          if (response.data.success) {
            // Update state if this is the active watchlist
            if (watchlistId === get().activeWatchlistId) {
              set((state) => ({
                activeSymbols: state.activeSymbols.filter(
                  (s) => s !== normalizedSymbol
                ),
              }));
            }

            return { success: true, message: 'Symbol removed successfully' };
          } else {
            return { success: false, message: response.data.message };
          }
        } catch (error) {
          console.error('Remove symbol error:', error);
          return {
            success: false,
            message: error.response?.data?.message || 'Failed to remove symbol',
          };
        }
      },

      // ============ ADD MULTIPLE SYMBOLS ============
      addMultipleSymbols: async (watchlistId, symbols) => {
        if (!watchlistId || !symbols || symbols.length === 0) {
          return { success: false, message: 'Watchlist ID and symbols are required' };
        }

        const results = {
          added: [],
          failed: [],
        };

        for (const symbol of symbols) {
          const result = await get().addSymbol(watchlistId, symbol);
          if (result.success) {
            results.added.push(symbol);
          } else {
            results.failed.push({ symbol, reason: result.message });
          }
        }

        return {
          success: results.added.length > 0,
          message: `Added ${results.added.length} symbol(s), ${results.failed.length} failed`,
          data: results,
        };
      },

      // ============ REMOVE ALL SYMBOLS ============
      removeAllSymbols: async (watchlistId) => {
        if (!watchlistId) {
          return { success: false, message: 'Watchlist ID is required' };
        }

        const { activeSymbols, activeWatchlistId } = get();
        const symbolsToRemove =
          watchlistId === activeWatchlistId ? activeSymbols : [];

        if (symbolsToRemove.length === 0) {
          // Fetch symbols first
          const response = await api.get(`/watchlists/${watchlistId}/symbols`);
          const symbols = response.data.data?.map((s) => s.symbol) || [];
          
          for (const symbol of symbols) {
            await get().removeSymbol(watchlistId, symbol);
          }
        } else {
          for (const symbol of symbolsToRemove) {
            await get().removeSymbol(watchlistId, symbol);
          }
        }

        return { success: true, message: 'All symbols removed' };
      },

      // ============ REORDER SYMBOLS ============
      reorderSymbols: (watchlistId, newOrder) => {
        set((state) => ({
          symbolOrder: {
            ...state.symbolOrder,
            [watchlistId]: newOrder,
          },
          activeSymbols:
            state.activeWatchlistId === watchlistId ? newOrder : state.activeSymbols,
        }));
      },

      // ============ MOVE SYMBOL ============
      moveSymbol: (watchlistId, fromIndex, toIndex) => {
        const { activeSymbols, activeWatchlistId } = get();

        if (watchlistId !== activeWatchlistId) return;

        const newSymbols = [...activeSymbols];
        const [removed] = newSymbols.splice(fromIndex, 1);
        newSymbols.splice(toIndex, 0, removed);

        set((state) => ({
          activeSymbols: newSymbols,
          symbolOrder: {
            ...state.symbolOrder,
            [watchlistId]: newSymbols,
          },
        }));
      },

      // ============ SET ACTIVE WATCHLIST ============
      setActiveWatchlistId: (watchlistId) => {
        set({ activeWatchlistId: watchlistId });
      },

      // ============ CHECK IF SYMBOL IN WATCHLIST ============
      isSymbolInWatchlist: (symbol, watchlistId = null) => {
        const { activeSymbols, activeWatchlistId } = get();
        const wlId = watchlistId || activeWatchlistId;

        if (!wlId) return false;

        return activeSymbols.includes(symbol.toUpperCase());
      },

      // ============ TOGGLE SYMBOL ============
      toggleSymbol: async (watchlistId, symbol) => {
        const isInWatchlist = get().isSymbolInWatchlist(symbol, watchlistId);

        if (isInWatchlist) {
          return await get().removeSymbol(watchlistId, symbol);
        } else {
          return await get().addSymbol(watchlistId, symbol);
        }
      },

      // ============ RECENT SYMBOLS ============
      addRecentSymbol: (symbol) => {
        const normalizedSymbol = symbol.toUpperCase().trim();
        const { recentSymbols, maxRecentSymbols } = get();

        // Remove if already exists
        const filtered = recentSymbols.filter((s) => s !== normalizedSymbol);

        // Add to front
        const newRecent = [normalizedSymbol, ...filtered].slice(0, maxRecentSymbols);

        set({ recentSymbols: newRecent });
      },

      clearRecentSymbols: () => {
        set({ recentSymbols: [] });
      },

      // ============ GET WATCHLIST BY ID ============
      getWatchlistById: (watchlistId) => {
        const { watchlists } = get();
        return watchlists.find((w) => w.id === watchlistId);
      },

      // ============ GET DEFAULT WATCHLIST ============
      getDefaultWatchlist: () => {
        const { watchlists } = get();
        return watchlists.find((w) => w.is_default);
      },

      // ============ SEARCH WATCHLISTS ============
      searchWatchlists: (query) => {
        const { watchlists } = get();
        if (!query || !query.trim()) return watchlists;

        const lowerQuery = query.toLowerCase().trim();
        return watchlists.filter((w) =>
          w.name.toLowerCase().includes(lowerQuery)
        );
      },

      // ============ GET SYMBOL COUNT ============
      getSymbolCount: (watchlistId) => {
        const { activeSymbols, activeWatchlistId } = get();

        if (watchlistId === activeWatchlistId) {
          return activeSymbols.length;
        }

        // Would need to fetch for other watchlists
        return null;
      },

      // ============ EXPORT WATCHLIST ============
      exportWatchlist: async (watchlistId) => {
        const { watchlists, activeSymbols, activeWatchlistId } = get();
        const watchlist = watchlists.find((w) => w.id === watchlistId);

        if (!watchlist) {
          return { success: false, message: 'Watchlist not found' };
        }

        let symbols = [];
        if (watchlistId === activeWatchlistId) {
          symbols = activeSymbols;
        } else {
          const response = await api.get(`/watchlists/${watchlistId}/symbols`);
          symbols = response.data.data?.map((s) => s.symbol) || [];
        }

        const exportData = {
          name: watchlist.name,
          symbols,
          exportedAt: new Date().toISOString(),
          version: '1.0',
        };

        return {
          success: true,
          data: JSON.stringify(exportData, null, 2),
        };
      },

      // ============ IMPORT WATCHLIST ============
      importWatchlist: async (jsonString, options = {}) => {
        try {
          const importData = JSON.parse(jsonString);

          if (!importData.name || !importData.symbols) {
            throw new Error('Invalid watchlist file');
          }

          const { mergeWithExisting = false, targetWatchlistId = null } = options;

          if (mergeWithExisting && targetWatchlistId) {
            // Add symbols to existing watchlist
            const result = await get().addMultipleSymbols(
              targetWatchlistId,
              importData.symbols
            );
            return result;
          } else {
            // Create new watchlist
            const newWatchlist = await get().createWatchlist(importData.name, false);

            // Add symbols
            await get().addMultipleSymbols(newWatchlist.id, importData.symbols);

            return {
              success: true,
              data: newWatchlist,
              message: `Imported watchlist with ${importData.symbols.length} symbols`,
            };
          }
        } catch (error) {
          return {
            success: false,
            message: error.message || 'Failed to import watchlist',
          };
        }
      },

      // ============ CLEAR ERROR ============
      clearError: () => set({ error: null }),

      // ============ RESET STORE ============
      reset: () =>
        set({
          watchlists: [],
          activeWatchlistId: null,
          activeSymbols: [],
          loading: false,
          error: null,
          symbolOrder: {},
          recentSymbols: [],
        }),
    }),
    {
      name: 'watchlist-storage',
      version: 1,
      partialize: (state) => ({
        activeWatchlistId: state.activeWatchlistId,
        symbolOrder: state.symbolOrder,
        recentSymbols: state.recentSymbols,
      }),
    }
  )
);

export default useWatchlistStore;