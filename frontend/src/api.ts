import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/';
    }
    return Promise.reject(error);
  }
);

export const login = (username: string, password: string) =>
  api.post('/auth/login', { username, password });

export const getKpis = (dateFrom?: string, dateTo?: string) =>
  api.get('/dashboard/kpis', { params: { dateFrom, dateTo } });

export const getTimeSeries = (dateFrom?: string, dateTo?: string) =>
  api.get('/dashboard/timeseries', { params: { dateFrom, dateTo } });

export const getShops = (dateFrom?: string, dateTo?: string) =>
  api.get('/dashboard/shops', { params: { dateFrom, dateTo } });

export const getProducts = (dateFrom?: string, dateTo?: string) =>
  api.get('/dashboard/products', { params: { dateFrom, dateTo } });

export const getAccounts = () =>
  api.get('/dashboard/accounts');

export const getGeo = (dateFrom?: string, dateTo?: string) =>
  api.get('/dashboard/geo', { params: { dateFrom, dateTo } });

export const getDiscounts = (dateFrom?: string, dateTo?: string) =>
  api.get('/dashboard/discounts', { params: { dateFrom, dateTo } });

export default api;