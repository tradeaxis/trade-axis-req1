import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const PUBLIC_AUTH_ROUTES = ['/auth/login', '/auth/switch-account'];

const api = axios.create({
  baseURL: API_URL,
  timeout: 45000,
});

api.interceptors.request.use((config) => {
  const requestUrl = config.url || '';
  const skipAuth =
    config.skipAuth === true ||
    PUBLIC_AUTH_ROUTES.some((route) => requestUrl.includes(route));

  const token = localStorage.getItem('token');
  if (token && !skipAuth) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  if (skipAuth && config.headers?.Authorization) {
    delete config.headers.Authorization;
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const requestUrl = error.config?.url || '';
      if (!requestUrl.includes('/auth/me') && !requestUrl.includes('/auth/switch-account')) {
        localStorage.removeItem('token');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
