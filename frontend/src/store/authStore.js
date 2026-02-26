import { create } from 'zustand';
import api from '../services/api';
import socketService from '../services/socket';

const useAuthStore = create((set) => ({
  user: null,
  accounts: [],
  token: localStorage.getItem('token'),
  isAuthenticated: false,
  isLoading: true,

  login: async (email, password) => {
    try {
      const response = await api.post('/auth/login', { email, password });
      const { user, accounts, token } = response.data.data;
      
      localStorage.setItem('token', token);
      socketService.connect(token);
      
      set({ user, accounts, token, isAuthenticated: true, isLoading: false });
      return { success: true };
    } catch (error) {
      return { success: false, message: error.response?.data?.message || 'Login failed' };
    }
  },

  // register: async (userData) => {
  //   try {
  //     const response = await api.post('/auth/register', userData);
  //     const { user, accounts, token } = response.data.data;
      
  //     localStorage.setItem('token', token);
  //     socketService.connect(token);
      
  //     set({ user, accounts, token, isAuthenticated: true, isLoading: false });
  //     return { success: true };
  //   } catch (error) {
  //     return { success: false, message: error.response?.data?.message || 'Registration failed' };
  //   }
  // },

  logout: () => {
    localStorage.removeItem('token');
    socketService.disconnect();
    set({ user: null, accounts: [], token: null, isAuthenticated: false });
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
      socketService.connect(token);
      set({ user, accounts, token, isAuthenticated: true, isLoading: false });
    } catch (error) {
      localStorage.removeItem('token');
      set({ user: null, accounts: [], token: null, isAuthenticated: false, isLoading: false });
    }
  },

  setAccounts: (accounts) => set({ accounts }),
}));

export default useAuthStore;