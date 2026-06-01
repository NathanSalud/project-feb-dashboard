import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:3000',
});

// Attach JWT token to every request automatically
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Redirect to login if token is expired or invalid
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

export const getKpis = () =>
  api.get('/dashboard/kpis');

export const getTimeSeries = () =>
  api.get('/dashboard/timeseries');

export const getShops = () =>
  api.get('/dashboard/shops');

export const getProducts = () =>
  api.get('/dashboard/products');

export const getAccounts = () =>
  api.get('/dashboard/accounts');

export default api;