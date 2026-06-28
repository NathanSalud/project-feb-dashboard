import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000',
});

function isTokenExpired(token: string): boolean {
  try {
    const [, payload] = token.split('.');
    const { exp } = JSON.parse(atob(payload));
    return typeof exp === 'number' && exp * 1000 <= Date.now();
  } catch {
    return true; // unparseable → treat as invalid
  }
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  // Never send an unauthenticated request — it would 401 and trip the logout
  // handler. Fail locally instead; a request-interceptor rejection short-circuits
  // and never reaches the response 401 handler.
  if (!token) return Promise.reject(new Error('No auth token'));
  config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let loggingOut = false;
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const token = localStorage.getItem('token');
      // Only end the session if the token is genuinely missing/expired. A 401
      // with a still-valid token is a transient/server-side fault and must NOT
      // nuke the session. De-dupe so concurrent 401s act at most once.
      if (!token || isTokenExpired(token)) {
        if (!loggingOut) {
          loggingOut = true;
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          window.location.href = '/';
        }
      }
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

export const getDoi = () =>
  api.get('/dashboard/doi');

export default api;