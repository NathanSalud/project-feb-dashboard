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

export const getTimeSeries = (dateFrom?: string, dateTo?: string, brand?: string, category?: string) =>
  api.get('/dashboard/timeseries', { params: { dateFrom, dateTo, brand, category } });

export const getShops = (dateFrom?: string, dateTo?: string, brand?: string) =>
  api.get('/dashboard/shops', { params: { dateFrom, dateTo, brand } });

// Brand & Category filter options for the dropdowns (scoped to the tenant).
export const getProductDims = (company?: string) =>
  api.get('/dashboard/product-dims', { params: { company } });

export const getProducts = (dateFrom?: string, dateTo?: string, brand?: string) =>
  api.get('/dashboard/products', { params: { dateFrom, dateTo, brand } });

// Date-aware, cross-platform-merged Top Products (#6). Filters are applied
// server-side so the ranking always matches the active scorecard date range.
export const getProductsRanked = (
  dateFrom?: string, dateTo?: string, platform?: string, account?: string, company?: string,
  brand?: string, category?: string,
) => api.get('/dashboard/products-ranked', { params: { dateFrom, dateTo, platform, account, company, brand, category } });

export const getAccounts = () =>
  api.get('/dashboard/accounts');

export const getGeo = (period = 'overall', brand?: string, category?: string) =>
  api.get('/dashboard/geo', { params: { period, brand, category } });

export const getDiscounts = (dateFrom?: string, dateTo?: string, brand?: string, category?: string) =>
  api.get('/dashboard/discounts', { params: { dateFrom, dateTo, brand, category } });

export const getDoi = () =>
  api.get('/dashboard/doi');

export const getPersonas = (period = 'lifetime', brand?: string, category?: string) =>
  api.get('/dashboard/personas', { params: { period, brand, category } });

export const getCancellations = (dateFrom?: string, dateTo?: string, brand?: string, category?: string) =>
  api.get('/dashboard/cancellations', { params: { dateFrom, dateTo, brand, category } });

export const getRetention = () =>
  api.get('/dashboard/retention');

// Brand/category-aware repeat purchase for the active scope (single row).
export const getRetentionFiltered = (
  account?: string, platform?: string, brand?: string, category?: string, company?: string,
) => api.get('/dashboard/retention-filtered', { params: { account, platform, brand, category, company } });

export default api;