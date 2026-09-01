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

// Endpoints reachable without a token (login, and any future public auth
// routes like register/refresh under /auth/).
const PUBLIC_PATHS = ['/auth/'];
const isPublicPath = (url?: string) => !!url && PUBLIC_PATHS.some((p) => url.includes(p));

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
    return config;
  }
  // No token: let public/auth endpoints through (login has no token yet).
  // Reject only PROTECTED requests so they don't fire header-less, 401, and
  // trip the logout handler. A request-interceptor rejection short-circuits
  // and never reaches the response 401 handler.
  if (isPublicPath(config.url)) return config;
  return Promise.reject(new Error('No auth token'));
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

// Reuses the shared `api` instance, so the request interceptor attaches the
// Bearer token automatically. Confirm field is client-side only — not sent.
export const changePassword = (currentPassword: string, newPassword: string) =>
  api.post('/auth/change-password', { currentPassword, newPassword });

export const getKpis = (dateFrom?: string, dateTo?: string, brand?: string) =>
  api.get('/dashboard/kpis', { params: { dateFrom, dateTo, brand } });

export const getTimeSeries = (dateFrom?: string, dateTo?: string, brand?: string) =>
  api.get('/dashboard/timeseries', { params: { dateFrom, dateTo, brand } });

export const getShops = (dateFrom?: string, dateTo?: string, brand?: string) =>
  api.get('/dashboard/shops', { params: { dateFrom, dateTo, brand } });

export const getProducts = (dateFrom?: string, dateTo?: string, brand?: string) =>
  api.get('/dashboard/products', { params: { dateFrom, dateTo, brand } });

export const getAccounts = () =>
  api.get('/dashboard/accounts');

export const getGeo = (period = 'overall') =>
  api.get('/dashboard/geo', { params: { period } });

export const getDiscounts = (dateFrom?: string, dateTo?: string, brand?: string) =>
  api.get('/dashboard/discounts', { params: { dateFrom, dateTo, brand } });

export const getDoi = () =>
  api.get('/dashboard/doi');

export const getPersonas = (period = 'lifetime') =>
  api.get('/dashboard/personas', { params: { period } });

export default api;