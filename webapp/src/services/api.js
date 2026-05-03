import axios from 'axios';

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_URL,
  timeout: 45000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('trade_axis_web_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('trade_axis_web_token');
      localStorage.removeItem('trade_axis_web_auth');
      if (!window.location.pathname.includes('/login')) {
        window.location.reload();
      }
    }
    return Promise.reject(error);
  },
);

export default api;
