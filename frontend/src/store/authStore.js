// frontend/src/store/authStore.js
import { create } from 'zustand';
import api from '../services/api';
import socketService from '../services/socket';

const SAVED_ACCOUNTS_KEY = 'trade_axis_saved_accounts';

// ✅ Helper: deduplicate saved accounts by loginId, then by email
const deduplicateAccounts = (accounts) => {
  const seen = new Set();
  return accounts.filter((acc) => {
    const key = acc.loginId || acc.email;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const loginRequest = (loginId, password) => {
  const body = new URLSearchParams({
    loginId,
    password,
  });

  return api.post('/auth/login', body, {
    skipAuth: true,
    timeout: 45000,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });
};

const useAuthStore = create((set, get) => ({
  user: null,
  accounts: [],
  token: localStorage.getItem('token'),
  isAuthenticated: false,
  isLoading: true,
  savedAccounts: deduplicateAccounts(
    JSON.parse(localStorage.getItem(SAVED_ACCOUNTS_KEY) || '[]')
  ),

  login: async (loginId, password) => {
    try {
      console.log('🔐 Login API Base URL:', api.defaults.baseURL);

      const response = await loginRequest(loginId, password);
      const { user, accounts, token } = response.data.data || {};

      if (!user || !token) {
        return { success: false, message: 'Invalid login response from server' };
      }

      localStorage.setItem('token', token);

      // ✅ Set auth state first
      set({
        user,
        accounts,
        token,
        isAuthenticated: true,
        isLoading: false,
      });

      get().saveCurrentAccount();

      // ✅ Socket failure should not fail login
      try {
        socketService.connect(token);
      } catch (socketError) {
        console.warn('⚠️ Socket connection failed after login:', socketError);
      }

      return { success: true };
    } catch (error) {
      console.error('❌ Login error details:', {
        baseURL: api.defaults.baseURL,
        message: error.message,
        code: error.code,
        status: error.response?.status,
        data: error.response?.data,
      });

      let message = error.response?.data?.message;

      if (!message) {
        if (error.code === 'ERR_NETWORK') {
          message = `Network error. Could not reach ${api.defaults.baseURL}`;
        } else {
          message = error.message || 'Login failed';
        }
      }

      return { success: false, message };
    }
  },

  logout: () => {
    localStorage.removeItem('token');
    socketService.disconnect();
    set({ user: null, accounts: [], token: null, isAuthenticated: false });
  },

  fullLogout: (loginId) => {
    const { savedAccounts } = get();
    const updated = savedAccounts.filter(
      (acc) => acc.loginId !== loginId && acc.email !== loginId
    );
    localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(updated));

    localStorage.removeItem('token');
    socketService.disconnect();
    set({
      user: null,
      accounts: [],
      token: null,
      isAuthenticated: false,
      savedAccounts: updated,
    });
  },

  checkAuth: async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      set({ isLoading: false });
      return;
    }

    try {
      const response = await api.get('/auth/me');
      const { user, accounts } = response.data.data;

      set({
        user,
        accounts,
        token,
        isAuthenticated: true,
        isLoading: false,
      });

      get().saveCurrentAccount();

      try {
        socketService.connect(token);
      } catch (socketError) {
        console.warn('⚠️ Socket reconnect failed during checkAuth:', socketError);
      }
    } catch (error) {
      localStorage.removeItem('token');
      set({
        user: null,
        accounts: [],
        token: null,
        isAuthenticated: false,
        isLoading: false,
      });
    }
  },

  setAccounts: (accounts) => set({ accounts }),

  saveCurrentAccount: () => {
    const { user, token, savedAccounts } = get();
    if (!user || !token) return;

    const maxSaved =
      user.maxSavedAccounts === -1 ? 999 : user.maxSavedAccounts || 10;

    const existingIndex = savedAccounts.findIndex(
      (acc) =>
        (acc.loginId && acc.loginId === user.loginId) ||
        (!acc.loginId && acc.email === user.email)
    );

    const accountData = {
      id: user.id,
      loginId: user.loginId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      token,
      savedAt: new Date().toISOString(),
    };

    let updated;
    if (existingIndex >= 0) {
      updated = [...savedAccounts];
      updated[existingIndex] = {
        ...updated[existingIndex],
        ...accountData,
      };
    } else {
      updated = [accountData, ...savedAccounts].slice(0, maxSaved);
    }

    updated = deduplicateAccounts(updated);

    localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(updated));
    set({ savedAccounts: updated });
  },

  addAccount: async (loginId, password) => {
    const { user: currentUser, savedAccounts } = get();
    const maxSaved =
      currentUser?.maxSavedAccounts === -1
        ? 999
        : currentUser?.maxSavedAccounts || 5;

    if (savedAccounts.length >= maxSaved) {
      return {
        success: false,
        message:
          maxSaved === 999
            ? 'Cannot add more accounts'
            : `Maximum ${maxSaved} saved accounts allowed. Remove one first.`,
      };
    }

    try {
      const response = await loginRequest(loginId, password);
      const { user, token } = response.data.data;

      if (
        savedAccounts.some(
          (acc) =>
            (acc.loginId && acc.loginId === user.loginId) ||
            acc.email === user.email
        )
      ) {
        return { success: false, message: 'Account already saved' };
      }

      const accountData = {
        id: user.id,
        loginId: user.loginId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        token: token,
        savedAt: new Date().toISOString(),
      };

      const updated = deduplicateAccounts([...savedAccounts, accountData]);
      localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(updated));
      set({ savedAccounts: updated });

      return { success: true, message: 'Account added successfully' };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || 'Login failed',
      };
    }
  },

  switchToAccount: async (savedAccount) => {
    try {
      if (!savedAccount?.token) {
        return {
          success: false,
          message: 'Saved session not available for this account. Please login again.',
          requiresLogin: true,
        };
      }

      const response = await api.post(
        '/auth/switch-account',
        {
          loginId: savedAccount.loginId || null,
          email: savedAccount.email || null,
          token: savedAccount.token,
        },
        {
          skipAuth: true,
        }
      );

      const { user, accounts, token } = response.data.data;

      localStorage.setItem('token', token);

      try {
        socketService.disconnect();
      } catch {}

      try {
        socketService.connect(token);
      } catch (socketError) {
        console.warn('⚠️ Socket switch connect failed:', socketError);
      }

      // ✅ refresh saved account token after successful switch
      const updatedSavedAccounts = deduplicateAccounts(
        get().savedAccounts.map((acc) => {
          const sameAccount =
            (acc.loginId && acc.loginId === (savedAccount.loginId || user.loginId)) ||
            (acc.email && savedAccount.email && acc.email === savedAccount.email);

          if (!sameAccount) return acc;

          return {
            ...acc,
            loginId: user.loginId,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            token,
            savedAt: new Date().toISOString(),
          };
        })
      );

      localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(updatedSavedAccounts));

      set({
        user,
        accounts,
        token,
        isAuthenticated: true,
        isLoading: false,
        savedAccounts: updatedSavedAccounts,
      });

      get().saveCurrentAccount();

      return { success: true };
    } catch (error) {
      const status = error.response?.status;

      return {
        success: false,
        message:
          error.response?.data?.message || 'Failed to switch account',
        // ✅ only mark requiresLogin for auth failures, not 500 errors
        requiresLogin: status === 401 || status === 403,
      };
    }
  },

  removeSavedAccount: (identifier) => {
    const { savedAccounts, user } = get();

    if (user?.loginId === identifier || user?.email === identifier) {
      return { success: false, message: 'Cannot remove currently active account' };
    }

    const updated = savedAccounts.filter(
      (acc) => acc.loginId !== identifier && acc.email !== identifier
    );

    localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(updated));
    set({ savedAccounts: updated });

    return { success: true };
  },

  getMaxSavedAccounts: () => {
    const { user } = get();
    const max = user?.maxSavedAccounts;
    if (max === -1 || max === undefined) return '∞';
    return max || 5;
  },

  isClosingMode: () => {
    const { user } = get();
    return user?.closingMode || false;
  },
}));

export default useAuthStore;
