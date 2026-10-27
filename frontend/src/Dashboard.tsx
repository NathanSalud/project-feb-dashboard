import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useState, useEffect, useRef } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import { useAuth } from './AuthContext';
import api, { getKpis, getTimeSeries, getShops, getProductsRanked, getGeo, getDiscounts, getDoi, getCancellations, getRetention, getRetentionFiltered, getProductDims, getNewVsExisting } from './api';
import PersonasTab from './PersonasTab';
import ComparePanels from './ComparePanels';
import ChangePasswordModal from './ChangePasswordModal';
import posthog from './posthog';
import gdecLogo from './assets/gdec-logo.png';

const TEAL   = '#1a7a8a';
const GOLD   = '#f5a623';
const BLUE2  = '#2a6080';
const LIGHT  = '#f0f4f8';
const WHITE  = '#ffffff';
const BORDER = '#e2e8f0';
const TEXT1  = '#1a2332';
const TEXT2  = '#4a5568';
const TEXT3  = '#94a3b8';

const PLAT_COLORS: Record<string, string> = {
  Shopee: '#f05a28', Lazada: '#1a56db', Tiktok: '#161823',
};
const PIE_COLORS = [TEAL, GOLD, BLUE2, '#22c98a', '#9b6ff0', '#e85555'];

// Sales-by-Province time windows (precomputed & cached per window server-side).
// `key` is the API `period`; `overall` = all time 2023 onwards (previous default).
const GEO_PERIODS = [
  { key: 'overall', label: 'Overall',    note: 'all time · 2023 onwards' },
  { key: 'ytd',     label: 'YTD',        note: 'year-to-date' },
  { key: '12m',     label: 'Past 12 mo', note: 'past 12 months' },
  { key: '24m',     label: 'Past 24 mo', note: 'past 24 months' },
] as const;

export default function Dashboard() {
  // Hidden for now — insights analyze all 2023–2026 data regardless of the user's date
  // filter, so they read as too broad. Re-enable once /insights/generate respects the
  // active date range.
  const SHOW_AI_INSIGHTS = false;
  const { user, logout } = useAuth();
  // Buyer-persona (RFM) tab. Backend is live at /dashboard/personas. Shown to the
  // gdec_admin account ONLY for internal review of the data/filters before any
  // client rollout (free vs. subscription tier still TBD). Flip to a broader
  // condition (or `true`) when it's approved for tenants.
  const SHOW_PERSONAS = !!user?.isAdmin;
  // Account Breakdown (account × platform) is admin-only. For a tenant it's
  // effectively a duplicate of Shop Performance — 164 of 165 account×platform
  // grains map to exactly one shop, so the two tables show the same rows with
  // only the label differing. Admins keep it: it's the only cross-tenant view
  // carrying the Company + Account columns. Tenants default to Shop Performance.
  const SHOW_ACCOUNT_BREAKDOWN = !!user?.isAdmin;

  // Filter memory (#3): restore each user's last-used filters from localStorage
  // on mount and persist them on change, so logging back in returns to the same
  // view. Keyed per username so accounts don't inherit each other's filters.
  const FILTERS_KEY = `gdec_filters_${user?.username || 'anon'}`;
  const savedFilters: any = (() => { try { return JSON.parse(localStorage.getItem(FILTERS_KEY) || '{}'); } catch { return {}; } })();
  const todayStr = new Date().toISOString().slice(0, 10);

  const [cCompany, setCCompany]   = useState<string>(savedFilters.cCompany ?? 'all');
  const [cAcc, setCAcc]           = useState<string>(savedFilters.cAcc ?? 'all');
  const [cPlat, setCPlat]         = useState<string>(savedFilters.cPlat ?? 'all');
  const [cBrand, setCBrand]       = useState<string>(savedFilters.cBrand ?? 'all');
  const [cCategory, setCCategory] = useState<string>(savedFilters.cCategory ?? 'all');
  const [dateFrom, setDateFrom]   = useState<string>(savedFilters.dateFrom ?? '2023-01-01');
  // End date starts at the saved value, else today; the snap effect below only
  // moves it to the latest day present when there is NO saved range.
  const [dateTo, setDateTo]       = useState<string>(savedFilters.dateTo ?? todayStr);
  // Debounced copies of the range that actually drive the data queries (~400ms
  // lag) so dragging the range doesn't fire a burst of fetches.
  const [qDateFrom, setQDateFrom] = useState<string>(savedFilters.dateFrom ?? '2023-01-01');
  const [qDateTo, setQDateTo]     = useState<string>(savedFilters.dateTo ?? todayStr);
  const [activeTab, setActiveTab] = useState<'breakdown'|'shops'|'products'|'doi'>(
    (savedFilters.activeTab && (user?.isAdmin || savedFilters.activeTab !== 'breakdown'))
      ? savedFilters.activeTab
      : (user?.isAdmin ? 'breakdown' : 'shops'));
  const [granularity, setGranularity] = useState<'day'|'week'|'month'|'quarter'|'year'>(savedFilters.granularity ?? 'month');
  const [sortCol, setSortCol] = useState<string>('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [insights, setInsights]   = useState<string>('');
  const [insightLoading, setInsightLoading] = useState(false);
  const [doiCustomer, setDoiCustomer] = useState('all');
  const [doiSearch, setDoiSearch] = useState('');              // Inventory DOI search (#10)
  const [geoPeriod, setGeoPeriod] = useState<string>(savedFilters.geoPeriod ?? 'overall'); // Sales-by-Province time window
  const [geoShowAll, setGeoShowAll] = useState(false);          // Province top-10 vs view-all (#8)
  const [showChangePw, setShowChangePw] = useState(false);
  // Trends chart-type override: 'mixed' keeps each metric's natural type (flows as
  // bars, ratios as lines); 'bar'/'line' force every Trends chart to one type so
  // they read consistently side by side.
  const [trendType, setTrendType] = useState<'mixed'|'bar'|'line'>('mixed');
  // Shared search box for the Shop Performance & Top Products tables (DOI keeps its own).
  const [tableSearch, setTableSearch] = useState('');
  // Date quick-jump: pick a Year (and optionally a Month) to snap the From–To range
  // to that whole year or month. The day-level From/To inputs remain for fine control.
  const [jumpYear, setJumpYear] = useState<string>('');
  const [jumpMonth, setJumpMonth] = useState<string>('all');

  const { data: kpis = [], isFetching: kFetch } = useQuery({
    queryKey: ['kpis', qDateFrom, qDateTo, cBrand],
    queryFn: () => getKpis(qDateFrom, qDateTo, cBrand).then(r => r.data),
    placeholderData: keepPreviousData,
  });
  const { data: timeSeries = [], isFetching: tFetch } = useQuery({
    queryKey: ['timeseries', qDateFrom, qDateTo, cBrand, cCategory],
    queryFn: () => getTimeSeries(qDateFrom, qDateTo, cBrand, cCategory).then(r => r.data),
    placeholderData: keepPreviousData,
  });
  // Brand & Category filter options, scoped to the selected company (admins) /
  // the tenant's own company. Drives the two global dropdowns.
  const { data: productDims = { brands: [], categories: [] } } = useQuery({
    queryKey: ['product-dims', cCompany, cAcc, cPlat, cBrand, cCategory],
    queryFn: () => getProductDims(cCompany, cAcc, cPlat, cBrand, cCategory).then(r => r.data),
    enabled: !!user,
    placeholderData: keepPreviousData,
  });
  const brandOptions: string[] = productDims?.brands ?? [];
  const categoryOptions: string[] = productDims?.categories ?? [];
  // True when a brand or category filter is active.
  const bcActive = cBrand !== 'all' || cCategory !== 'all';

  // If the active brand/category drops out of the newly-cascaded option list (e.g.
  // after switching account/platform, or because they no longer co-occur), reset it
  // to "all" so the dropdown never shows a stale selection with no matching data.
  useEffect(() => {
    if (cBrand !== 'all' && brandOptions.length > 0 && !brandOptions.includes(cBrand)) setCBrand('all');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandOptions]);
  useEffect(() => {
    if (cCategory !== 'all' && categoryOptions.length > 0 && !categoryOptions.includes(cCategory)) setCCategory('all');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryOptions]);
  const { data: shopsRes, isFetching: sFetch } = useQuery({
    queryKey: ['shops', qDateFrom, qDateTo, cBrand],
    queryFn: () => getShops(qDateFrom, qDateTo, cBrand).then(r => r.data),
    placeholderData: keepPreviousData,
  });
  const shops = shopsRes?.data ?? [];
  // Top Products is now date-aware + cross-platform merged (#6): the server ranks
  // within the active date range and platform/account/company scope, so the result
  // is already filtered — no client-side re-filter needed, and it tracks the
  // scorecard date range the same way the trend charts do.
  const { data: products = [], isFetching: pFetch } = useQuery({
    queryKey: ['products-ranked', qDateFrom, qDateTo, cPlat, cAcc, cCompany, cBrand, cCategory],
    queryFn: () => getProductsRanked(qDateFrom, qDateTo, cPlat, cAcc, cCompany, cBrand, cCategory).then(r => r.data),
    placeholderData: keepPreviousData,
  });
  const { data: geoRaw = [] } = useQuery({
    queryKey: ['geo', geoPeriod, cBrand, cCategory],
    queryFn: () => getGeo(geoPeriod, cBrand, cCategory).then(r => r.data),
    placeholderData: keepPreviousData,
  });
  const { data: discountsRaw = [], isFetching: dFetch } = useQuery({
    queryKey: ['discounts', qDateFrom, qDateTo, cBrand, cCategory],
    queryFn: () => getDiscounts(qDateFrom, qDateTo, cBrand, cCategory).then(r => r.data),
    placeholderData: keepPreviousData,
  });
  const { data: doiRaw = [] } = useQuery({
    queryKey: ['doi'],
    queryFn: () => getDoi().then(r => r.data),
    enabled: !!user, // DOI is now company-scoped server-side; available to every tenant + admin
  });
  const { data: cancellations = [], isFetching: cxFetch } = useQuery({
    queryKey: ['cancellations', qDateFrom, qDateTo, cBrand, cCategory],
    queryFn: () => getCancellations(qDateFrom, qDateTo, cBrand, cCategory).then(r => r.data),
    placeholderData: keepPreviousData,
  });
  const { data: retention = [], isFetching: retFetch } = useQuery({
    queryKey: ['retention'],
    queryFn: () => getRetention().then(r => r.data),
    enabled: !!user, // trailing-12mo repeat metrics; company-scoped server-side
  });
  // When a brand/category filter is active, repeat purchase is recomputed on demand
  // for the exact active scope (single row) instead of read from the precompute.
  const { data: retFiltered, isFetching: retFFetch } = useQuery({
    queryKey: ['retention-filtered', cCompany, cAcc, cPlat, cBrand, cCategory],
    queryFn: () => getRetentionFiltered(cAcc, cPlat, cBrand, cCategory, cCompany).then(r => r.data),
    enabled: !!user && (cBrand !== 'all' || cCategory !== 'all'),
    placeholderData: keepPreviousData,
  });
  // New vs existing buyers for the active scope + date range (date-aware, on demand).
  const { data: newVsExisting, isFetching: nveFetch } = useQuery({
    queryKey: ['new-vs-existing', qDateFrom, qDateTo, cCompany, cAcc, cPlat, cBrand, cCategory],
    queryFn: () => getNewVsExisting(qDateFrom, qDateTo, cPlat, cAcc, cCompany, cBrand, cCategory).then(r => r.data),
    enabled: !!user,
    placeholderData: keepPreviousData,
  });
  const doiCustomers = [...new Set((doiRaw as any[]).map(r => r.CUSTOMER_ID))].sort();
  // Rows are tagged server-side with COMPANY_NAME/ACCOUNT_NAMES. Tenants filter by the
  // global account selector (cAcc); admins keep the raw CUST_ID dropdown.
  const doiSearchLc = doiSearch.trim().toLowerCase();
  const doiFiltered = (doiRaw as any[]).filter(r =>
    (user?.isAdmin ? (doiCustomer === 'all' || r.CUSTOMER_ID === doiCustomer) : true) &&
    (cCompany === 'all' || r.COMPANY_NAME === cCompany) &&
    (cAcc === 'all' || (r.ACCOUNT_NAMES || []).includes(cAcc)) &&
    (!doiSearchLc ||
      String(r.PRODUCT_NAME || '').toLowerCase().includes(doiSearchLc) ||
      String(r.PRODUCT_SKU  || '').toLowerCase().includes(doiSearchLc))
  );

  const isLoading = kFetch || tFetch || sFetch || pFetch || dFetch;

  // Debounce the query date range: the pickers set dateFrom/dateTo instantly, but
  // the queries only pick up the change ~400ms after the last edit, so adjusting
  // the range fires one fetch instead of several. Combined with keepPreviousData
  // above, the current view stays on screen while the new range loads.
  useEffect(() => {
    const t = setTimeout(() => { setQDateFrom(dateFrom); setQDateTo(dateTo); }, 400);
    return () => clearTimeout(t);
  }, [dateFrom, dateTo]);

  // On first data load, snap the end date to the latest day present in the data,
  // so the default range always ends on the newest (day-1) data instead of a
  // stale hardcoded date. Runs once; a manual edit to the end date pins it.
  // Pre-pin when a saved end date was restored, so the snap below doesn't override it.
  const dateToPinned = useRef(!!savedFilters.dateTo);
  useEffect(() => {
    if (dateToPinned.current || !timeSeries.length) return;
    const latest = (timeSeries as any[]).reduce((mx: string, r: any) => {
      const d = r.ORDER_DATE instanceof Date
        ? r.ORDER_DATE.toISOString().slice(0, 10)
        : String(r.ORDER_DATE || r.ORDER_MONTH || '').slice(0, 10);
      return d > mx ? d : mx;
    }, '');
    if (latest) { setDateTo(latest); dateToPinned.current = true; }
  }, [timeSeries]);

  // Persist the active filters so the next login restores them (#3).
  useEffect(() => {
    try {
      localStorage.setItem(FILTERS_KEY, JSON.stringify({
        cCompany, cAcc, cPlat, cBrand, cCategory, dateFrom, dateTo, granularity, geoPeriod, activeTab,
      }));
    } catch { /* storage unavailable (private mode) — skip */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cCompany, cAcc, cPlat, cBrand, cCategory, dateFrom, dateTo, granularity, geoPeriod, activeTab]);

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  const sortData = (data: any[], col: string) => {
    if (!col) return data;
    return [...data].sort((a, b) => {
      const av = a[col] ?? '';
      const bv = b[col] ?? '';
      // Numeric comparison when BOTH values are numbers (or numeric strings, as
      // Snowflake sometimes returns money/counts) — otherwise sort as text.
      const an = typeof av === 'number' ? av : parseFloat(av);
      const bn = typeof bv === 'number' ? bv : parseFloat(bv);
      const bothNum = Number.isFinite(an) && Number.isFinite(bn)
        && String(av).trim() !== '' && String(bv).trim() !== '';
      if (bothNum) return sortDir === 'asc' ? an - bn : bn - an;
      return sortDir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
  };

  // Date quick-jump helpers. Years run 2023 → current year; a month of 'all' snaps the
  // range to the whole year, otherwise to that single month. Both ends are clamped to
  // today so a partly-future period never over-reaches the available data.
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const curYear = new Date().getFullYear();
  const jumpYears = Array.from({ length: curYear - 2023 + 1 }, (_, i) => String(2023 + i));
  const applyJump = (year: string, month: string) => {
    if (!year) return;
    const todayS = new Date().toISOString().slice(0, 10);
    let from: string, to: string;
    if (month === 'all') {
      from = `${year}-01-01`; to = `${year}-12-31`;
    } else {
      const mi = Number(month);                       // 0-11
      const mm = String(mi + 1).padStart(2, '0');
      const last = new Date(Number(year), mi + 1, 0).getDate();
      from = `${year}-${mm}-01`;
      to   = `${year}-${mm}-${String(last).padStart(2, '0')}`;
    }
    if (from > todayS) from = todayS;
    if (to   > todayS) to   = todayS;
    if (from > to) from = to;
    dateToPinned.current = true;
    setDateFrom(from); setDateTo(to);
    posthog.capture('dashboard_date_quickjump', { year, month });
  };


  const platforms = [...new Set(kpis.map((k: any) => k.PLATFORM))] as string[];
  const accounts  = [...new Set(kpis.map((k: any) => k.ACCOUNT_NAME))] as string[];

  // Admin-only drill-down: distinct companies, and accounts cascaded to the
  // currently selected company (so the account list stays scoped, not a flat
  // dump of every account across every brand).
  const companies = [...new Set(kpis.map((k: any) => k.COMPANY_NAME))].filter(Boolean).sort() as string[];
  const adminAccounts = [...new Set(
    kpis.filter((k: any) => cCompany === 'all' || k.COMPANY_NAME === cCompany)
        .map((k: any) => k.ACCOUNT_NAME)
  )].filter(Boolean).sort() as string[];

  // Company predicate — inert for tenants (cCompany stays 'all'); the real
  // access boundary remains the accountNames / isAdmin check below.
  const companyMatch = (r: any) => cCompany === 'all' || r.COMPANY_NAME === cCompany;

  // KPI totals from time series (date-aware)
  const tsRevOrd = timeSeries
    .filter((r: any) =>
      companyMatch(r) &&
      (cPlat === 'all' || r.PLATFORM === cPlat) &&
      (cAcc  === 'all' || r.ACCOUNT_NAME === cAcc) &&
      (user?.isAdmin || user?.accountNames?.includes(r.ACCOUNT_NAME))
    )
    .reduce((acc: any, r: any) => ({
      revenue:    (acc.revenue    || 0) + Number(r.REVENUE),        // gross GMV (incl. cancelled)
      revValid:   (acc.revValid   || 0) + Number(r.REVENUE_VALID),  // valid-only GMV (NMV/discount base)
      orders:     (acc.orders     || 0) + Number(r.ORDERS),
      items:      (acc.items      || 0) + Number(r.ITEMS),
      pd:         (acc.pd         || 0) + Number(r.PLATFORM_DISCOUNT),
      sd:         (acc.sd         || 0) + Number(r.SELLER_DISCOUNT),
      ship:       (acc.ship       || 0) + Number(r.SHIPPING_DISCOUNT),
    }), {});

  const totals = {
    // GMV is gross — it now INCLUDES cancelled orders (decision Oct 2026). NMV,
    // discounts, orders and items stay net of cancellations (valid statuses only),
    // so NMV/Discount reconciliation runs off REVENUE_VALID, not gross GMV.
    revenue:  tsRevOrd.revenue  || 0,   // gross GMV (incl. cancelled)
    revValid: tsRevOrd.revValid || 0,   // valid-only GMV (base for NMV / discount rate)
    orders:   tsRevOrd.orders   || 0,
    items:    tsRevOrd.items    || 0,
    pd:       tsRevOrd.pd        || 0,
    sd:       tsRevOrd.sd        || 0,
    ship:     tsRevOrd.ship      || 0,
    // NMV = valid-order merchandise value, measured BEFORE discounts — it differs
    // from gross GMV only by excluding cancelled orders (NMV = REVENUE_VALID). So
    // GMV − NMV = the cancelled-order value. Discounts are NOT subtracted here; they
    // live in the Discount Analysis section and the Discount Rate KPI below.
    nmv:      (tsRevOrd.revValid || 0),
  };
  const aov      = totals.orders > 0 ? totals.revenue / totals.orders : 0;  // gross GMV ÷ valid orders
  // Discount Rate is the product-discount give-back as a share of valid (NMV) sales —
  // an independent metric now that NMV is gross of discounts. NMV% is NMV as a share
  // of gross GMV, i.e. the non-cancelled share.
  const discRate = totals.revValid > 0 ? (((totals.pd + totals.sd) / totals.revValid) * 100).toFixed(1) : '0.0';
  const nmvPct   = totals.revenue > 0 ? ((totals.nmv / totals.revenue) * 100).toFixed(1) : '0.0';

  // ── Cancellation rate (date-aware; server already date-filtered) ──
  const cxAgg = (cancellations as any[])
    .filter((r: any) =>
      companyMatch(r) &&
      (cPlat === 'all' || r.PLATFORM === cPlat) &&
      (cAcc  === 'all' || r.ACCOUNT_NAME === cAcc) &&
      (user?.isAdmin || user?.accountNames?.includes(r.ACCOUNT_NAME))
    )
    .reduce((a: any, r: any) => ({
      items:     a.items     + Number(r.ITEMS || 0),
      cancelled: a.cancelled + Number(r.CANCELLED || 0),
      returned:  a.returned  + Number(r.RETURNED || 0),
    }), { items: 0, cancelled: 0, returned: 0 });
  const cancelRate = cxAgg.items > 0 ? ((cxAgg.cancelled / cxAgg.items) * 100).toFixed(1) : '0.0';

  // ── Repeat purchase (trailing 12 mo; not tied to the date picker) ──
  // Select the precomputed row matching the active company/platform filter.
  // Tenants only receive their own company's rows; '__ALL__' is the rollup.
  const retEffCompany = user?.isAdmin ? (cCompany === 'all' ? '__ALL__' : cCompany) : user?.companyName;
  const retEffAccount = cAcc === 'all' ? '__ALL__' : cAcc;
  const retEffPlatform = cPlat === 'all' ? '__ALL__' : cPlat;
  const retRow = (retention as any[]).find(
    (r: any) => r.COMPANY_NAME === retEffCompany && r.ACCOUNT_NAME === retEffAccount && r.PLATFORM === retEffPlatform
  );
  // With a brand/category filter active, use the on-demand filtered row; otherwise
  // the precomputed row matching the active company/account/platform.
  const retDisplay: any = bcActive ? retFiltered : retRow;

  // Time series chart data
  const groupKey = (dateStr: string) => {
    const d = new Date(dateStr);
    if (granularity === 'day')     return dateStr.slice(0,10);
    if (granularity === 'week')    { const s = new Date(d); s.setDate(d.getDate() - d.getDay()); return s.toISOString().slice(0,10); }
    if (granularity === 'month')   return dateStr.slice(0,7);
    if (granularity === 'quarter') { const q = Math.floor(d.getMonth()/3)+1; return `${d.getFullYear()}-Q${q}`; }
    if (granularity === 'year')    return String(d.getFullYear());
    return dateStr.slice(0,7);
  };

  type PerPlat = {revenue:number;revValid:number;orders:number;items:number;pd:number;sd:number};
  const chartData = (() => {
    const map: Record<string, {revenue:number;revValid:number;orders:number;items:number;pd:number;sd:number;plat:Record<string,PerPlat>}> = {};
    timeSeries.forEach((r: any) => {
      if(!companyMatch(r) || (cPlat !== 'all' && r.PLATFORM !== cPlat) || (cAcc !== 'all' && r.ACCOUNT_NAME !== cAcc)) return;
      const raw = r.ORDER_DATE instanceof Date ? r.ORDER_DATE.toISOString().slice(0,10) : String(r.ORDER_DATE||r.ORDER_MONTH).slice(0,10);
      const key = groupKey(raw);
      if(!map[key]) map[key] = {revenue:0,revValid:0,orders:0,items:0,pd:0,sd:0,plat:{}};
      const m = map[key];
      m.revenue  += Number(r.REVENUE);
      m.revValid += Number(r.REVENUE_VALID);
      m.orders   += Number(r.ORDERS);
      m.items    += Number(r.ITEMS);
      m.pd       += Number(r.PLATFORM_DISCOUNT);
      m.sd       += Number(r.SELLER_DISCOUNT);
      const p = r.PLATFORM;
      if(!m.plat[p]) m.plat[p] = {revenue:0,revValid:0,orders:0,items:0,pd:0,sd:0};
      m.plat[p].revenue  += Number(r.REVENUE);
      m.plat[p].revValid += Number(r.REVENUE_VALID);
      m.plat[p].orders   += Number(r.ORDERS);
      m.plat[p].items    += Number(r.ITEMS);
      m.plat[p].pd       += Number(r.PLATFORM_DISCOUNT);
      m.plat[p].sd       += Number(r.SELLER_DISCOUNT);
    });
    return Object.entries(map).sort((a,b)=>a[0].localeCompare(b[0])).map(([k,d])=>{
      const row: Record<string, any> = {
        month: granularity === 'month' ? new Date(k+'-01').toLocaleDateString('en-US',{month:'short',year:'2-digit'})
             : granularity === 'year'  ? k
             : granularity === 'quarter' ? k
             : new Date(k).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit'}),
        // revenue = gross GMV (incl. cancelled); aov uses it over valid orders.
        revenue: d.revenue, orders: d.orders, items: d.items,
        aov: d.orders > 0 ? Math.round(d.revenue/d.orders) : 0,
        // NMV per period = valid-order GMV before discounts (excl. cancelled only).
        nmv: d.revValid,
        // Average Basket Size = units per order (a ratio, so it is never stacked across platforms).
        abs: d.orders > 0 ? d.items/d.orders : 0,
      };
      for(const [p, pv] of Object.entries(d.plat)) {
        row[`revenue__${p}`] = pv.revenue;
        row[`orders__${p}`]  = pv.orders;
        row[`items__${p}`]   = pv.items;
        row[`aov__${p}`]     = pv.orders > 0 ? Math.round(pv.revenue/pv.orders) : 0;
        row[`nmv__${p}`]     = pv.revValid;
        row[`abs__${p}`]     = pv.orders > 0 ? pv.items/pv.orders : 0;
      }
      return row;
    });
  })();

  // Split the trend charts by platform only in the "All Platforms" overview; a
  // specific platform selection collapses back to a single series (drill-down).
  const ORDERED_PLATS = ['Shopee', 'Tiktok', 'Lazada'];
  const splitPlats = cPlat === 'all'
    ? ORDERED_PLATS.filter(p => chartData.some((row: any) => row[`revenue__${p}`] != null))
    : [];

  // ── Date-aware table/pie source ──────────────────────────────────
  // The Account Breakdown table, Shop Performance table and Sales-by-Platform pie
  // are all derived from the SAME date-aware timeseries rows that feed the
  // scorecards, aggregated to (company, account, platform). This is what fixes the
  // scorecard-vs-table mismatch (#1/#5/#11): the tables now respect the date picker
  // because they share the scorecards' source and date filter. REVENUE is gross GMV.
  const tsFilteredRows = (timeSeries as any[]).filter((r: any) =>
    companyMatch(r) &&
    (cPlat === 'all' || r.PLATFORM === cPlat) &&
    (cAcc  === 'all' || r.ACCOUNT_NAME === cAcc) &&
    (user?.isAdmin || user?.accountNames?.includes(r.ACCOUNT_NAME))
  );
  const breakdownRows = (() => {
    const map: Record<string, any> = {};
    tsFilteredRows.forEach((r: any) => {
      const key = `${r.COMPANY_NAME}|${r.ACCOUNT_NAME}|${r.PLATFORM}`;
      if (!map[key]) map[key] = { COMPANY_NAME: r.COMPANY_NAME, ACCOUNT_NAME: r.ACCOUNT_NAME, PLATFORM: r.PLATFORM, ORDERS: 0, ITEMS: 0, REVENUE: 0 };
      map[key].ORDERS  += Number(r.ORDERS);
      map[key].ITEMS   += Number(r.ITEMS);
      map[key].REVENUE += Number(r.REVENUE);
    });
    return Object.values(map).sort((a: any, b: any) => b.REVENUE - a.REVENUE);
  })();
  // Shop Performance = the account/platform aggregation above, labelled with shop
  // name/ID from the shops dimension (reused only as a lookup now; its metrics are
  // lifetime and no longer displayed).
  const shopLookup: Record<string, any> = {};
  (shops as any[]).forEach((s: any) => { shopLookup[`${s.COMPANY_NAME}|${s.ACCOUNT_NAME}|${s.PLATFORM}`] = s; });
  const shopRows = breakdownRows.map((r: any) => {
    const sl = shopLookup[`${r.COMPANY_NAME}|${r.ACCOUNT_NAME}|${r.PLATFORM}`] || {};
    return {
      SHOP_NAME: sl.SHOP_NAME ?? r.ACCOUNT_NAME,
      PLATFORM:  r.PLATFORM,
      SHOP_ID:   sl.SHOP_ID ?? '—',
      ORDERS:    r.ORDERS,
      ITEMS:     r.ITEMS,
      AOV:       r.ORDERS > 0 ? r.REVENUE / r.ORDERS : 0,
      REVENUE:   r.REVENUE,
    };
  });

  // Shared table search term (Shop Performance & Top Products).
  const tableSearchLc = tableSearch.trim().toLowerCase();

  // Shop Performance view: search (shop name / ID) + optional column sort.
  const shopRowsView = sortData(
    shopRows.filter((s: any) => !tableSearchLc ||
      String(s.SHOP_NAME || '').toLowerCase().includes(tableSearchLc) ||
      String(s.SHOP_ID   || '').toLowerCase().includes(tableSearchLc)),
    sortCol);

  // Top Products view: add SOB (share of total GMV for the active scope), then
  // search (product name / SKU) + optional column sort. SOB uses the scorecard GMV
  // as denominator so it reads as "% of total GMV", not "% of the shown top-50".
  const sobDenom = totals.revenue > 0
    ? totals.revenue
    : (products as any[]).reduce((s: number, p: any) => s + Number(p.REVENUE || 0), 0);
  const productRows = sortData(
    (products as any[])
      .map((p: any) => ({ ...p, SOB: sobDenom > 0 ? (Number(p.REVENUE || 0) / sobDenom) * 100 : 0 }))
      .filter((p: any) => !tableSearchLc ||
        String(p.PRODUCT_NAME || '').toLowerCase().includes(tableSearchLc) ||
        String(p.PRODUCT_SKU  || '').toLowerCase().includes(tableSearchLc)),
    sortCol);

  // Sales by platform pie — date-aware (gross GMV share over the filtered period).
  const platPie = (() => {
    const map: Record<string, number> = {};
    tsFilteredRows.forEach((r: any) => { map[r.PLATFORM] = (map[r.PLATFORM] || 0) + Number(r.REVENUE); });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  })();
  const platTotal = platPie.reduce((s, d) => s + d.value, 0);  // for SOB % labels

  // Geo data
  const geoSorted = (() => {
    const filtered = geoRaw.filter((r: any) =>
      companyMatch(r) &&
      (cPlat === 'all' || r.PLATFORM === cPlat) &&
      (cAcc  === 'all' || r.ACCOUNT_NAME === cAcc) &&
      (user?.isAdmin || user?.accountNames?.includes(r.ACCOUNT_NAME))
    );
    const map: Record<string, { value: number; orders: number }> = {};
    filtered.forEach((r: any) => {
      if (!map[r.SHIPPING_PROVINCE]) map[r.SHIPPING_PROVINCE] = { value: 0, orders: 0 };
      map[r.SHIPPING_PROVINCE].value  += Number(r.REVENUE);
      map[r.SHIPPING_PROVINCE].orders += Number(r.ORDERS || 0);
    });
    return Object.entries(map)
      .sort((a,b) => b[1].value - a[1].value)
      .map(([name, d]) => ({ name, value: d.value, orders: d.orders }));
  })();
  // Top 10 by default; "View all" (#8) expands to every province.
  const geoData = geoShowAll ? geoSorted : geoSorted.slice(0, 10);

  // Discount time series
  const discChartData = (() => {
    const map: Record<string, {pd:number;sd:number;ship:number;sship:number}> = {};
    discountsRaw.forEach((r: any) => {
      if(!companyMatch(r)) return;
      if((cPlat !== 'all' && r.PLATFORM !== cPlat) || (cAcc !== 'all' && r.ACCOUNT_NAME !== cAcc)) return;
      if(!user?.isAdmin && !user?.accountNames?.includes(r.ACCOUNT_NAME)) return;
      const raw = r.ORDER_DATE instanceof Date ? r.ORDER_DATE.toISOString().slice(0,10) : String(r.ORDER_DATE).slice(0,10);
      // Always bucket by month (YYYY-MM). This chart is "Total Discounts by Month"
      // and lives in Discount Analysis, so it must NOT follow the Trends section's
      // granularity toggle (that shared state previously re-bucketed this chart).
      const key = raw.slice(0,7);
      if(!map[key]) map[key] = {pd:0,sd:0,ship:0,sship:0};
      map[key].pd    += Number(r.PLATFORM_DISCOUNT||0);
      map[key].sd    += Number(r.SELLER_DISCOUNT||0);
      map[key].ship  += Number(r.SHIPPING_DISCOUNT||0);
      map[key].sship += Number(r.SELLER_SHIPPING_DISCOUNT||0);
    });
    return Object.entries(map).sort((a,b)=>a[0].localeCompare(b[0])).map(([k,d])=>({
      month: new Date(k+'-01').toLocaleDateString('en-US',{month:'short',year:'2-digit'}),
      'Platform Discount': d.pd,
      'Seller Discount':   d.sd,
      'Shipping Discount': d.ship,
      'Seller Shipping':   d.sship,
    }));
  })();

  // Discount pie
  const discPie = [
    { name: 'Platform Discount', value: totals.pd },
    { name: 'Seller Discount',   value: totals.sd },
    { name: 'Shipping Discount', value: totals.ship },
  ].filter(d => d.value > 0);
  const discTotal = discPie.reduce((s, d) => s + d.value, 0);  // for discount-share % labels

  const fmt  = (v: number) => v>=1e9?'₱'+(v/1e9).toFixed(1)+'B':v>=1e6?'₱'+(v/1e6).toFixed(1)+'M':v>=1e3?'₱'+(v/1e3).toFixed(0)+'K':'₱'+v.toFixed(0);
  const fmtN = (v: number) => v>=1e6?(v/1e6).toFixed(1)+'M':v>=1e3?(v/1e3).toFixed(0)+'K':v.toLocaleString();
  const fmtD = (v: number) => (v || 0).toFixed(2);

  const exportCSV = (data: any[], filename: string) => {
    if(!data.length) return;
    posthog.capture('dashboard_data_exported', { table: activeTab });
    const headers = Object.keys(data[0]).join(',');
    const rows = data.map(r => Object.values(r).map(v => `"${v}"`).join(','));
    const blob = new Blob([[headers,...rows].join('\n'),], {type:'text/csv'});
    const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click();
  };

  // Compact CSV-export button for individual chart cards (#9).
  const miniExport = (data: any[], filename: string) => (
    <button onClick={() => exportCSV(data, filename)} title="Download chart data (CSV)"
      style={{ flexShrink: 0, border: `1px solid ${BORDER}`, background: WHITE, color: TEXT3, borderRadius: 6, fontSize: 10, padding: '2px 7px', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' as const }}>
      ⬇ CSV
    </button>
  );

  const handleLogout = () => {
    posthog.capture('dashboard_signed_out');
    logout();
  };

  const generateInsights = async () => {
  if (!SHOW_AI_INSIGHTS) return;   // parked: no network call while hidden
  setInsightLoading(true);
  setInsights('');
  const summary = {
    company:    user?.isAdmin ? 'All Companies (GDEC Admin)' : user?.companyName,
    dateRange:  `${dateFrom} to ${dateTo}`,
    filters:    { account: cAcc, platform: cPlat },
    kpis: {
      totalRevenue:     fmt(totals.revenue),
      totalOrders:      fmtN(totals.orders),
      aov:              fmt(aov),
      discountRate:     discRate + '%',
      totalDiscount:    fmt(totals.pd + totals.sd),
      shippingDiscount: fmt(totals.ship),
    },
    topPlatform:  platPie.sort((a,b) => b.value - a.value)[0]?.name || 'N/A',
    topProvince:  geoData[0]?.name || 'N/A',
    chartTrend:   chartData.length > 1
      ? (chartData[chartData.length-1].revenue > chartData[0].revenue ? 'upward' : 'downward')
      : 'insufficient data',
  };

  try {
    // Use the shared `api` axios instance so this call picks up VITE_API_URL
    // in production and attaches the Bearer token via the request interceptor
    // (instead of the old hardcoded http://localhost:3000 fetch).
    const res = await api.post('/insights/generate', summary);
    setInsights(typeof res.data === 'string' ? res.data : JSON.stringify(res.data));
  } catch (err: any) {
    setInsights(`Error: ${err?.message || 'Unknown error. Please try again.'}`);
  } finally {
    setInsightLoading(false);
  }
};


  const ttStyle = { backgroundColor: WHITE, border: `1px solid ${BORDER}`, borderRadius: 8, color: TEXT1, fontSize: 11 };

  // `loading` dims + pulses the value while its data is refetching (e.g. on a
  // filter change) so a stale number isn't mistaken for the new one.
  const kpiCard = (label: string, value: string, sub: string, accent: string, loading = false) => (
    <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '16px 20px', borderTop: `3px solid ${accent}`, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <div style={{ fontSize: 10, letterSpacing: '.5px', textTransform: 'uppercase' as const, color: TEXT3, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: TEXT1, marginBottom: 4, ...(loading ? { animation: 'gdecPulse 1.1s ease-in-out infinite', color: TEXT3 } : {}) }}>{value}</div>
      <div style={{ fontSize: 10.5, color: TEXT3 }}>{sub}</div>
    </div>
  );

  const sectionLabel = (text: string, id?: string) => (
    <div id={id} style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase' as const, color: TEXT3, marginBottom: 12, marginTop: 8, paddingBottom: 8, borderBottom: `1px solid ${BORDER}`, scrollMarginTop: 80 }}>{text}</div>
  );

  return (
    <div style={{ minHeight: '100vh', background: LIGHT, color: TEXT1, fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 14 }}>
      <style>{`@keyframes gdecPulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>

      {/* TOPBAR */}
      <header style={{ position: 'sticky' as const, top: 0, zIndex: 30, background: WHITE, borderBottom: `1px solid ${BORDER}`, padding: '8px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 60, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', flexWrap: 'wrap' as const, gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src={gdecLogo} alt="GDEC" style={{ height: 36, objectFit: 'contain' }} />
          <div style={{ width: 1, height: 28, background: BORDER }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: TEAL }}>Account Intelligence</div>
            <div style={{ fontSize: 10, color: TEXT3 }}>{user?.isAdmin ? 'Admin View — All Companies' : (user?.displayName ?? user?.companyName)}</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
          {user?.isAdmin && (
            <select onChange={e => { setCCompany(e.target.value); setCAcc('all'); setCBrand('all'); setCCategory('all'); }} value={cCompany} style={{ background: WHITE, border: `1px solid ${BORDER}`, color: TEXT1, fontFamily: 'inherit', fontSize: 12, padding: '5px 10px', borderRadius: 8, cursor: 'pointer' }}>
              <option value="all">All Companies</option>
              {companies.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {user?.isAdmin && (
            <select onChange={e => setCAcc(e.target.value)} value={cAcc} style={{ background: WHITE, border: `1px solid ${BORDER}`, color: TEXT1, fontFamily: 'inherit', fontSize: 12, padding: '5px 10px', borderRadius: 8, cursor: 'pointer' }}>
              <option value="all">All Accounts</option>
              {adminAccounts.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
          {user?.isAdmin && (
            <select onChange={e => setCPlat(e.target.value)} value={cPlat} disabled={activeTab === 'doi'}
              title={activeTab === 'doi' ? 'Platform does not apply to inventory (DOI)' : ''}
              style={{ background: WHITE, border: `1px solid ${BORDER}`, color: activeTab === 'doi' ? TEXT3 : TEXT1, fontFamily: 'inherit', fontSize: 12, padding: '5px 10px', borderRadius: 8, cursor: activeTab === 'doi' ? 'not-allowed' : 'pointer' }}>
              <option value="all">All Platforms</option>
              {platforms.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
          {!user?.isAdmin && accounts.length > 1 && (
            <select onChange={e => setCAcc(e.target.value)} value={cAcc} style={{ background: WHITE, border: `1px solid ${BORDER}`, color: TEXT1, fontFamily: 'inherit', fontSize: 12, padding: '5px 10px', borderRadius: 8, cursor: 'pointer' }}>
              <option value="all">All Accounts</option>
              {accounts.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
          {!user?.isAdmin && (
            <select onChange={e => setCPlat(e.target.value)} value={cPlat} disabled={activeTab === 'doi'}
              title={activeTab === 'doi' ? 'Platform does not apply to inventory (DOI)' : ''}
              style={{ background: WHITE, border: `1px solid ${BORDER}`, color: activeTab === 'doi' ? TEXT3 : TEXT1, fontFamily: 'inherit', fontSize: 12, padding: '5px 10px', borderRadius: 8, cursor: activeTab === 'doi' ? 'not-allowed' : 'pointer' }}>
              <option value="all">All Platforms</option>
              {platforms.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
          <select onChange={e => { setCBrand(e.target.value); posthog.capture('dashboard_filter_updated', { filter: 'brand' }); }} value={cBrand}
            title="Filter by brand (from product catalog)"
            style={{ background: WHITE, border: `1px solid ${cBrand !== 'all' ? TEAL : BORDER}`, color: TEXT1, fontFamily: 'inherit', fontSize: 12, padding: '5px 10px', borderRadius: 8, cursor: 'pointer', maxWidth: 170 }}>
            <option value="all">All Brands</option>
            {brandOptions.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <select onChange={e => { setCCategory(e.target.value); posthog.capture('dashboard_filter_updated', { filter: 'category' }); }} value={cCategory}
            title="Filter by product category (from product catalog)"
            style={{ background: WHITE, border: `1px solid ${cCategory !== 'all' ? TEAL : BORDER}`, color: TEXT1, fontFamily: 'inherit', fontSize: 12, padding: '5px 10px', borderRadius: 8, cursor: 'pointer', maxWidth: 170 }}>
            <option value="all">All Categories</option>
            {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '4px 10px' }}>
            <span style={{ fontSize: 10.5, color: TEXT3 }}>From</span>
            <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); posthog.capture('dashboard_filter_updated', { filter: 'date_from' }); }} style={{ background: 'transparent', border: 'none', color: TEXT1, fontFamily: 'inherit', fontSize: 12, outline: 'none', width: 110 }} />
            <span style={{ color: TEXT3 }}>—</span>
            <span style={{ fontSize: 10.5, color: TEXT3 }}>To</span>
            <input type="date" value={dateTo} onChange={e => { dateToPinned.current = true; setDateTo(e.target.value); posthog.capture('dashboard_filter_updated', { filter: 'date_to' }); }} style={{ background: 'transparent', border: 'none', color: TEXT1, fontFamily: 'inherit', fontSize: 12, outline: 'none', width: 110 }} />
          </div>
          {/* Quick-jump: snap the range to a whole year or month (day-level From/To above still works). */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '4px 8px' }} title="Jump the date range to a whole year or month">
            <span style={{ fontSize: 10.5, color: TEXT3 }}>Jump</span>
            <select value={jumpYear} onChange={e => { const y = e.target.value; setJumpYear(y); if (y) applyJump(y, jumpMonth); }}
              style={{ background: WHITE, border: `1px solid ${BORDER}`, color: TEXT1, fontFamily: 'inherit', fontSize: 12, padding: '3px 6px', borderRadius: 6, cursor: 'pointer' }}>
              <option value="">Year</option>
              {jumpYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <select value={jumpMonth} onChange={e => { const m = e.target.value; const y = jumpYear || String(curYear); setJumpYear(y); setJumpMonth(m); applyJump(y, m); }}
              style={{ background: WHITE, border: `1px solid ${BORDER}`, color: TEXT1, fontFamily: 'inherit', fontSize: 12, padding: '3px 6px', borderRadius: 6, cursor: 'pointer' }}>
              <option value="all">All months</option>
              {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
            </select>
          </div>
          {/* Fixed-width slot so toggling the loading indicator never reflows the
              header (previously its appearance pushed "Sign out" off the bar). */}
          <span style={{ fontSize: 11, color: TEAL, width: 74, flexShrink: 0, whiteSpace: 'nowrap' as const, textAlign: 'right' as const, visibility: isLoading ? 'visible' as const : 'hidden' as const }}>⟳ Loading...</span>
          <button onClick={handleLogout} style={{ padding: '5px 14px', borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 12, fontFamily: 'inherit', color: '#e85555', background: WHITE, cursor: 'pointer', flexShrink: 0 }}>Sign out</button>
        </div>
      </header>

      <div style={{ display: 'flex', gap: 20, padding: '20px 24px', alignItems: 'flex-start' }}>

        {/* QUICK-NAV SIDEBAR */}
        <aside style={{ position: 'sticky' as const, top: 80, alignSelf: 'flex-start', width: 190, flexShrink: 0 }}>
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase' as const, color: TEXT3, marginBottom: 10, padding: '0 4px' }}>Navigate</div>
            {[
              { id: 'performance-overview', label: 'Performance Overview' },
              { id: 'trends',               label: 'Trends' },
              { id: 'comparison',           label: 'Comparison' },
              { id: 'data-tables',          label: 'Data Tables' },
              { id: 'geographic-platform',  label: 'Geographic & Platform' },
              { id: 'discount-analysis',    label: 'Discount Analysis' },
              ...(SHOW_PERSONAS ? [{ id: 'buyer-personas', label: 'Buyer Personas' }] : []),
            ].map(s => (
              <button key={s.id}
                onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                style={{ display: 'block', width: '100%', textAlign: 'left' as const, padding: '8px 10px', marginBottom: 4, borderRadius: 8, border: '1px solid transparent', background: 'transparent', color: TEXT2, fontFamily: 'inherit', fontSize: 12, cursor: 'pointer' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(26,122,138,0.08)'; e.currentTarget.style.color = TEAL; e.currentTarget.style.border = `1px solid ${BORDER}`; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = TEXT2; e.currentTarget.style.border = '1px solid transparent'; }}>
                {s.label}
              </button>
            ))}
            <div style={{ height: 1, background: BORDER, margin: '10px 4px' }} />
            <button
              onClick={() => setShowChangePw(true)}
              style={{ display: 'block', width: '100%', textAlign: 'left' as const, padding: '8px 10px', borderRadius: 8, border: `1px solid ${BORDER}`, background: 'transparent', color: TEAL, fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(26,122,138,0.08)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
              🔑 Change Password
            </button>
          </div>
        </aside>

        {/* MAIN CONTENT */}
        <main style={{ flex: 1, minWidth: 0 }}>

        {/* KPI CARDS */}
        {sectionLabel('Performance Overview', 'performance-overview')}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px,1fr))', gap: 12, marginBottom: 20 }}>
          {kpiCard('Total GMV',       fmt(totals.revenue), 'Gross · incl. cancelled orders', TEAL, tFetch)}
          {kpiCard('Total NMV',       fmt(totals.nmv),     `Excl. cancelled orders · before discounts · ${nmvPct}% of GMV`, '#14808a', tFetch)}
          {kpiCard('Total Orders',    fmtN(totals.orders), 'Unique platform orders · excl. cancelled', GOLD, tFetch)}
          {kpiCard('Avg Order Value', fmt(aov),            'GMV ÷ orders',                         BLUE2, tFetch)}
          {kpiCard('Items Sold',      fmtN(totals.items),  'Units sold · excl. cancelled',             '#22c98a', tFetch)}
          {kpiCard('Avg Basket Size', totals.orders > 0 ? (totals.items/totals.orders).toFixed(2) : '—', 'Items ÷ orders', '#0ea5b7', tFetch)}
          {kpiCard('Discount Rate',   discRate + '%',       'Of original product price',               '#9b6ff0', tFetch)}
          {kpiCard('Cancellation Rate', cancelRate + '%',   'Share of items cancelled',                '#e85555', cxFetch)}
          {kpiCard('Repeat Purchase Rate',
                   (retDisplay && retDisplay.REPEAT_RATE != null) ? retDisplay.REPEAT_RATE + '%' : '—',
                   (retDisplay && retDisplay.REPEAT_GMV_SHARE != null) ? `${retDisplay.REPEAT_GMV_SHARE}% of GMV · trailing 12mo` : 'Trailing 12 months', '#22a06b',
                   bcActive ? retFFetch : retFetch)}
          {kpiCard('New vs Returning Buyers',
                   (newVsExisting && newVsExisting.BUYERS > 0 && newVsExisting.NEW_RATE != null) ? `${newVsExisting.NEW_RATE}% new` : '—',
                   (newVsExisting && newVsExisting.BUYERS > 0)
                     ? `${newVsExisting.EXISTING_RATE}% returning · ${fmtN(Number(newVsExisting.BUYERS))} buyers in range`
                     : 'First purchase in the selected range = new', '#6b8cce',
                   nveFetch)}
        </div>

        {/* TIME SERIES CHARTS */}
        {sectionLabel('Trends', 'trends')}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          <span style={{ fontSize: 10, color: TEXT3, letterSpacing: '.4px', textTransform: 'uppercase' as const, marginRight: 4 }}>Granularity</span>
          {(['day','week','month','quarter','year'] as const).map(g => (
            <button key={g} onClick={() => { setGranularity(g); posthog.capture('dashboard_granularity_changed', { granularity: g }); }}
              style={{ padding: '4px 10px', borderRadius: 7, border: `1px solid ${granularity===g ? TEAL : BORDER}`, fontSize: 11, fontFamily: 'inherit', cursor: 'pointer', background: granularity===g ? `rgba(26,122,138,0.1)` : WHITE, color: granularity===g ? TEAL : TEXT2, textTransform: 'capitalize' as const }}
              title={g !== 'month' ? 'Available in next phase' : ''}>{g}</button>
          ))}
          <span style={{ width: 1, height: 18, background: BORDER, margin: '0 6px' }} />
          <span style={{ fontSize: 10, color: TEXT3, letterSpacing: '.4px', textTransform: 'uppercase' as const, marginRight: 4 }}>Chart type</span>
          {([['mixed','Default'],['bar','Bars'],['line','Lines']] as const).map(([val, lbl]) => (
            <button key={val} onClick={() => setTrendType(val)}
              style={{ padding: '4px 10px', borderRadius: 7, border: `1px solid ${trendType===val ? TEAL : BORDER}`, fontSize: 11, fontFamily: 'inherit', cursor: 'pointer', background: trendType===val ? `rgba(26,122,138,0.1)` : WHITE, color: trendType===val ? TEAL : TEXT2 }}
              title={val === 'mixed' ? 'Each metric uses its natural chart type' : `Show every trend as a ${lbl.toLowerCase().replace(/s$/, '')} chart`}>{lbl}</button>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 12, marginBottom: 20 }}>
          {[
            { title: 'GMV by Month',           key: 'revenue', color: TEAL,      type: 'line', fmt: fmt,  suffix: '' },
            { title: 'NMV by Month',           key: 'nmv',     color: '#14808a', type: 'bar',  fmt: fmt,  suffix: '' },
            { title: 'Orders by Month',        key: 'orders',  color: '#22c98a', type: 'bar',  fmt: fmtN, suffix: ' orders' },
            { title: 'Items Sold by Month',    key: 'items',   color: BLUE2,     type: 'bar',  fmt: fmtN, suffix: ' items' },
            { title: 'AOV by Month',           key: 'aov',     color: GOLD,      type: 'line', fmt: fmt,  suffix: '' },
            { title: 'Avg Basket Size by Month', key: 'abs',   color: '#0ea5b7', type: 'line', fmt: fmtD, suffix: ' items/order' },
          ].map(({ title, key, color, type, fmt: f, suffix }) => {
            const split = splitPlats.length > 0;
            // 'mixed' keeps each metric's natural type; otherwise force all to one.
            const effType = trendType === 'mixed' ? type : trendType;
            return (
            <div key={key} style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: TEXT1, marginBottom: 2 }}>{title}</div>
                {miniExport(
                  chartData.map((d: any) => {
                    const o: any = { month: d.month };
                    if (split) splitPlats.forEach(pp => { o[pp] = d[`${key}__${pp}`]; });
                    else o[key] = d[key];
                    return o;
                  }),
                  `${title.replace(/\s+/g, '_').toLowerCase()}.csv`,
                )}
              </div>
              <div style={{ fontSize: 10.5, color: TEXT3, marginBottom: 14 }}>Filtered period</div>
              <ResponsiveContainer width="100%" height={160}>
                {effType === 'line' ? (
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: TEXT3 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10, fill: TEXT3 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => f(v)} width={55} />
                    <Tooltip contentStyle={ttStyle} formatter={(v: any) => f(Number(v))} />
                    {split
                      ? splitPlats.map(p => <Line key={p} type="monotone" dataKey={`${key}__${p}`} name={p} stroke={PLAT_COLORS[p] || color} strokeWidth={2} dot={false} />)
                      : <Line type="monotone" dataKey={key} stroke={PLAT_COLORS[cPlat] || color} strokeWidth={2} dot={false} />}
                  </LineChart>
                ) : (
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: TEXT3 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10, fill: TEXT3 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => f(v)} width={45} />
                    <Tooltip contentStyle={ttStyle} formatter={(v: any) => f(Number(v)) + suffix} />
                    {split
                      ? splitPlats.map((p, idx) => <Bar key={p} dataKey={`${key}__${p}`} name={p} stackId="a" fill={PLAT_COLORS[p] || color} opacity={0.85} radius={idx === splitPlats.length-1 ? [3,3,0,0] : undefined} />)
                      : <Bar dataKey={key} fill={PLAT_COLORS[cPlat] || color} radius={[3,3,0,0]} opacity={0.8} />}
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
            );
          })}
        </div>

        {/* SIDE-BY-SIDE COMPARISON (#2) */}
        {sectionLabel('Comparison', 'comparison')}
        <ComparePanels user={user} cCompany={cCompany} cAcc={cAcc} cPlat={cPlat} cBrand={cBrand} cCategory={cCategory} />

        {/* TABS + TABLES */}
        {sectionLabel('Data Tables', 'data-tables')}
        <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
          {((SHOW_ACCOUNT_BREAKDOWN ? ['breakdown','shops','products','doi'] : ['shops','products','doi']) as Array<'breakdown'|'shops'|'products'|'doi'>).map(t => (
            <button key={t} onClick={() => { setActiveTab(t); setSortCol(''); setSortDir('asc'); setTableSearch(''); posthog.capture('dashboard_tab_selected', { tab: t }); }} style={{ padding: '6px 16px', borderRadius: 8, border: `1px solid ${activeTab===t ? TEAL : BORDER}`, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer', background: activeTab===t ? `rgba(26,122,138,0.08)` : WHITE, color: activeTab===t ? TEAL : TEXT2, fontWeight: activeTab===t ? 600 : 400, textTransform: 'capitalize' as const }}>
              {t === 'breakdown' ? 'Account Breakdown' : t === 'shops' ? 'Shop Performance' : t === 'products' ? 'Top Products' : 'Inventory DOI'}
            </button>
          ))}
        </div>

        <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 20, marginBottom: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: TEXT1 }}>
                {activeTab === 'breakdown' ? 'Account & Platform Breakdown' : activeTab === 'shops' ? 'Shop Performance' : activeTab === 'products' ? 'Top Products' : 'Inventory & Days of Inventory'}
              </div>
              <div style={{ fontSize: 10.5, color: TEXT3, marginTop: 2 }}>
                {activeTab === 'breakdown' ? 'GMV, orders and AOV · filtered period' : activeTab === 'shops' ? 'GMV, orders and AOV · filtered period' : activeTab === 'products' ? 'Best selling items by GMV · filtered period' : 'Current stock levels vs. 90-day order velocity · independent of date filters · inventory is at warehouse-customer grain; accounts sharing a warehouse customer show combined inventory'}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {(activeTab === 'shops' || activeTab === 'products') && (
              <input value={tableSearch} onChange={e => setTableSearch(e.target.value)}
                placeholder={activeTab === 'products' ? 'Search product or SKU…' : 'Search shop or ID…'}
                style={{ padding: '5px 10px', borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 11, fontFamily: 'inherit', color: TEXT1, background: WHITE, width: 200, outline: 'none' }} />
            )}
            {activeTab === 'doi' && (
              <input value={doiSearch} onChange={e => setDoiSearch(e.target.value)}
                placeholder="Search product or SKU…"
                style={{ padding: '5px 10px', borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 11, fontFamily: 'inherit', color: TEXT1, background: WHITE, width: 200, outline: 'none' }} />
            )}
            {activeTab === 'doi' && user?.isAdmin && (
  <select value={doiCustomer} onChange={e => setDoiCustomer(e.target.value)}
    style={{ marginRight: 8, padding: '5px 10px', borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 11, fontFamily: 'inherit', color: TEXT2, background: WHITE, cursor: 'pointer' }}>
    <option value="all">All customers</option>
    {doiCustomers.map(c => <option key={c} value={c}>{c}</option>)}
  </select>
)}<button onClick={() => exportCSV(activeTab==='breakdown'?breakdownRows:activeTab==='shops'?shopRowsView:activeTab==='products'?productRows:doiFiltered, `${activeTab}.csv`)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 11, fontFamily: 'inherit', color: '#22c98a', background: WHITE, cursor: 'pointer' }}>
              ⬇ Export CSV
            </button>
            </div>
          </div>
          <div style={{ overflowX: 'auto', maxHeight: 500, overflowY: 'auto' }}>
            {activeTab === 'breakdown' && (
              <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 }}>
                <thead><tr>
                  {user?.isAdmin && <th style={{ fontSize: 9.5, color: TEXT3, fontWeight: 500, padding: '0 0 10px', borderBottom: `1px solid ${BORDER}`, textAlign: 'left' as const }}>Company</th>}
                  <th style={{ fontSize: 9.5, color: TEXT3, fontWeight: 500, padding: '0 0 10px', borderBottom: `1px solid ${BORDER}`, textAlign: 'left' as const }}>Account</th>
                  <th style={{ fontSize: 9.5, color: TEXT3, fontWeight: 500, padding: '0 0 10px', borderBottom: `1px solid ${BORDER}`, textAlign: 'left' as const }}>Platform</th>
                  <th style={{ fontSize: 9.5, color: TEXT3, fontWeight: 500, padding: '0 0 10px', borderBottom: `1px solid ${BORDER}`, textAlign: 'left' as const }}>Orders</th>
                  <th style={{ fontSize: 9.5, color: TEXT3, fontWeight: 500, padding: '0 0 10px', borderBottom: `1px solid ${BORDER}`, textAlign: 'left' as const }}>Items</th>
                  <th style={{ fontSize: 9.5, color: TEXT3, fontWeight: 500, padding: '0 0 10px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' as const }}>GMV</th>
                </tr></thead>
                <tbody>
                  {breakdownRows.map((k: any, i: number) => (
                    <tr key={i} style={{ background: i%2===0 ? WHITE : '#fafbfc' }}>
                      {user?.isAdmin && <td style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}`, color: TEXT1, fontWeight: 500 }}>{k.COMPANY_NAME}</td>}
                      <td style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}`, color: TEXT2 }}>{k.ACCOUNT_NAME}</td>
                      <td style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}` }}>
                        <span style={{ background: `${PLAT_COLORS[k.PLATFORM] || TEAL}18`, color: PLAT_COLORS[k.PLATFORM] || TEAL, padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600 }}>{k.PLATFORM}</span>
                      </td>
                      <td style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}`, color: TEXT2, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{fmtN(Number(k.ORDERS))}</td>
                      <td style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}`, color: TEXT2, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{fmtN(Number(k.ITEMS))}</td>
                      <td style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}`, color: TEXT1, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, textAlign: 'right' as const, fontWeight: 600 }}>{fmt(Number(k.REVENUE))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {activeTab === 'shops' && (
              <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 }}>
                <thead><tr>
                  {[['Shop','SHOP_NAME'],['Platform','PLATFORM'],['Shop ID','SHOP_ID'],['Orders','ORDERS'],['Items','ITEMS'],['AOV','AOV'],['GMV','REVENUE']].map(([h,col],i) => (
                    <th key={h} onClick={() => handleSort(col)}
                      style={{ cursor: 'pointer', userSelect: 'none' as const, whiteSpace: 'nowrap' as const, fontSize: 9.5, color: TEXT3, fontWeight: 500, padding: '0 0 10px', borderBottom: `1px solid ${BORDER}`, textAlign: i>=3?'right' as const:'left' as const }}>
                      {h} {sortCol === col ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                    </th>
                  ))}
                </tr></thead>
                <tbody>
                  {shopRowsView.map((s: any, i: number) => (
                    <tr key={i} style={{ background: i%2===0 ? WHITE : '#fafbfc' }}>
                      <td style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}`, color: TEXT1, fontWeight: 500 }}>{s.SHOP_NAME}</td>
                      <td style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}` }}><span style={{ background: `${PLAT_COLORS[s.PLATFORM]||TEAL}18`, color: PLAT_COLORS[s.PLATFORM]||TEAL, padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600 }}>{s.PLATFORM}</span></td>
                      <td style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}`, color: TEXT3, fontSize: 10, fontFamily: 'monospace' }}>{s.SHOP_ID}</td>
                      <td style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}`, color: TEXT2, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, textAlign: 'right' as const }}>{fmtN(Number(s.ORDERS))}</td>
                      <td style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}`, color: TEXT2, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, textAlign: 'right' as const }}>{fmtN(Number(s.ITEMS))}</td>
                      <td style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}`, color: TEXT2, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, textAlign: 'right' as const }}>{fmt(Number(s.AOV))}</td>
                      <td style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}`, color: TEXT1, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, textAlign: 'right' as const, fontWeight: 600 }}>{fmt(Number(s.REVENUE))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {activeTab === 'products' && (
              <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 }}>
                <thead><tr>
                  {[['Product','PRODUCT_NAME'],['Platform','PLATFORM'],['SKU','PRODUCT_SKU'],['Orders','ORDERS'],['Units','UNITS'],['ASP','ASP'],['SOB','SOB'],['GMV','REVENUE']].map(([h,col],i) => (
                    <th key={h} onClick={() => handleSort(col)}
                      style={{ cursor: 'pointer', userSelect: 'none' as const, whiteSpace: 'nowrap' as const, fontSize: 9.5, color: TEXT3, fontWeight: 500, padding: '0 0 10px', borderBottom: `1px solid ${BORDER}`, textAlign: i>=3?'right' as const:'left' as const }}
                      title={col === 'SOB' ? 'Share of total GMV for the current filters' : undefined}>
                      {h} {sortCol === col ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                    </th>
                  ))}
                </tr></thead>
                <tbody>
                  {productRows.map((p: any, i: number) => {
                    const multi = Number(p.PLATFORM_COUNT) > 1;
                    return (
                    <tr key={i} style={{ background: i%2===0 ? WHITE : '#fafbfc' }}>
                      <td style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}`, color: TEXT1, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{p.PRODUCT_NAME}</td>
                      <td style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}` }}>{multi
                        ? <span title={`Combined across ${p.PLATFORM_COUNT} platforms`} style={{ background: `${TEXT3}18`, color: TEXT2, padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600 }}>Multi ({p.PLATFORM_COUNT})</span>
                        : <span style={{ background: `${PLAT_COLORS[p.PLATFORM]||TEAL}18`, color: PLAT_COLORS[p.PLATFORM]||TEAL, padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600 }}>{p.PLATFORM}</span>}</td>
                      <td style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}`, color: TEXT3, fontFamily: 'JetBrains Mono, monospace', fontSize: 10 }}>
                        {p.PRODUCT_SKU || '—'}{Number(p.SKU_COUNT) > 1 ? <span title={`${p.SKU_COUNT} SKUs under this product name`} style={{ color: TEXT3 }}> +{Number(p.SKU_COUNT) - 1}</span> : null}
                      </td>
                      <td style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}`, color: TEXT2, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, textAlign: 'right' as const }}>{fmtN(Number(p.ORDERS))}</td>
                      <td style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}`, color: TEXT2, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, textAlign: 'right' as const }}>{fmtN(Number(p.UNITS))}</td>
                      <td style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}`, color: TEXT2, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, textAlign: 'right' as const }}>{fmt(Number(p.ASP))}</td>
                      <td style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}`, color: TEXT2, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, textAlign: 'right' as const }}>{Number(p.SOB || 0).toFixed(1)}%</td>
                      <td style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}`, color: TEXT1, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, textAlign: 'right' as const, fontWeight: 600 }}>{fmt(Number(p.REVENUE))}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {activeTab === 'doi' && (
            <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 }}>
              <thead><tr>
                {['CUSTOMER_ID','PRODUCT_SKU','PRODUCT_NAME','INVENTORY_QTY','ORDERED_3M','DAILY_AVG_SOLD','DOI'].map((col, i) => (
                  <th key={col}
                    onClick={() => handleSort(col)}
                    style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', fontSize: 9.5, color: TEXT3, fontWeight: 500, padding: '0 0 10px', borderBottom: `1px solid ${BORDER}`, textAlign: i >= 3 ? 'right' : 'left' }}>
                    {col === 'CUSTOMER_ID' ? 'Customer' : col === 'PRODUCT_SKU' ? 'SKU' : col === 'PRODUCT_NAME' ? 'Product' : col === 'INVENTORY_QTY' ? 'Inventory Qty' : col === 'ORDERED_3M' ? 'Ordered (3M)' : col === 'DAILY_AVG_SOLD' ? 'Daily Avg' : 'DOI (Days)'}
                    {' '}{sortCol === col ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                  </th>
                ))}
              </tr></thead>
              <tbody>
                {sortData(doiFiltered, sortCol).map((r: any, i: number) => {
                  const isLow = r.DOI !== null && r.DOI < 14;
                  return (
                    <tr key={i} style={{ background: isLow ? '#fff0f0' : i % 2 === 0 ? WHITE : '#fafbfc' }}>
                      <td style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}`, color: isLow ? '#d32f2f' : TEXT1, fontWeight: isLow ? 600 : 400 }}>{r.CUSTOMER_ID}</td>
                      <td style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}`, color: TEXT2, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{r.PRODUCT_SKU}</td>
                      <td style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}`, color: TEXT1, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.PRODUCT_NAME}</td>
                      <td style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}`, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{Number(r.INVENTORY_QTY).toLocaleString()}</td>
                      <td style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}`, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{Number(r.ORDERED_3M).toLocaleString()}</td>
                      <td style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}`, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{Number(r.DAILY_AVG_SOLD).toLocaleString()}</td>
                      <td style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}`, textAlign: 'right', color: isLow ? '#d32f2f' : r.DOI === null ? TEXT3 : TEXT1, fontWeight: isLow ? 700 : 400, fontFamily: 'JetBrains Mono, monospace' }}>
                        {r.DOI === null ? 'No orders' : `${Number(r.DOI).toLocaleString()} days`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          </div>
        </div>

        {/* SALES BY PLATFORM + PROVINCE */}
        {sectionLabel('Geographic & Platform Distribution', 'geographic-platform')}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,2fr)', gap: 12, marginBottom: 20 }}>
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: TEXT1, marginBottom: 2 }}>Sales by Platform</div>
              {miniExport(platPie, 'sales_by_platform.csv')}
            </div>
            <div style={{ fontSize: 10.5, color: TEXT3, marginBottom: 14 }}>GMV share · filtered period</div>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={platPie} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value"
                  labelLine={false}
                  label={({ percent }: any) => `${((percent || 0) * 100).toFixed(1)}%`}>
                  {platPie.map((_, i) => <Cell key={i} fill={PLAT_COLORS[platPie[i]?.name] || PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={ttStyle}
                  formatter={(v: any) => `${fmt(Number(v))}${platTotal > 0 ? ` · ${((Number(v) / platTotal) * 100).toFixed(1)}% SOB` : ''}`} />
                <Legend formatter={(v) => <span style={{ fontSize: 11, color: TEXT2 }}>{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' as const }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: TEXT1, marginBottom: 2 }}>Sales by Province</div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' as const }}>
                {GEO_PERIODS.map(p => (
                  <button key={p.key} onClick={() => { setGeoPeriod(p.key); posthog.capture('dashboard_geo_period_changed', { period: p.key }); }}
                    style={{ padding: '3px 9px', borderRadius: 7, border: `1px solid ${geoPeriod === p.key ? TEAL : BORDER}`, fontSize: 10.5, fontFamily: 'inherit', cursor: 'pointer', background: geoPeriod === p.key ? 'rgba(26,122,138,0.1)' : WHITE, color: geoPeriod === p.key ? TEAL : TEXT2 }}>
                    {p.label}
                  </button>
                ))}
                <button onClick={() => setGeoShowAll(v => !v)}
                  style={{ padding: '3px 9px', borderRadius: 7, border: `1px solid ${geoShowAll ? TEAL : BORDER}`, fontSize: 10.5, fontFamily: 'inherit', cursor: 'pointer', background: geoShowAll ? 'rgba(26,122,138,0.1)' : WHITE, color: geoShowAll ? TEAL : TEXT2 }}>
                  {geoShowAll ? 'Top 10' : 'View all'}
                </button>
                {miniExport(geoSorted, 'sales_by_province.csv')}
              </div>
            </div>
            <div style={{ fontSize: 10.5, color: TEXT3, marginBottom: 14 }}>{geoShowAll ? `All ${geoData.length} provinces` : 'Top 10 provinces'} by GMV · {GEO_PERIODS.find(p => p.key === geoPeriod)?.note ?? 'all time · 2023 onwards'}</div>
            <ResponsiveContainer width="100%" height={geoShowAll ? Math.max(220, geoData.length * 20) : 220}>
              <BarChart data={geoData} layout="vertical" margin={{ left: 90 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: TEXT3 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => fmt(v)} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: TEXT2 }} axisLine={false} tickLine={false} width={85} />
                <Tooltip contentStyle={ttStyle}
                  formatter={(v: any, _n: any, p: any) => [`${fmt(Number(v))} · ${fmtN(Number(p?.payload?.orders || 0))} orders`, 'GMV']} />
                <Bar dataKey="value" fill={TEAL} radius={[0,3,3,0]} opacity={0.85} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* DISCOUNT SECTION */}
        {sectionLabel('Discount Analysis', 'discount-analysis')}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 12, marginBottom: 16 }}>
          {[
            { label: 'Platform Discount', value: fmt(totals.pd),         sub: `${totals.revValid>0?((totals.pd/totals.revValid)*100).toFixed(1):0}% of valid GMV`, color: TEAL },
            { label: 'Seller Discount',   value: fmt(totals.sd),         sub: `${totals.revValid>0?((totals.sd/totals.revValid)*100).toFixed(1):0}% of valid GMV`, color: GOLD },
            { label: 'Shipping Discount', value: fmt(totals.ship),       sub: `${totals.revValid>0?((totals.ship/totals.revValid)*100).toFixed(1):0}% of valid GMV`, color: BLUE2 },
          ].map(({ label, value, sub, color }) => (
            <div key={label} style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '14px 18px', borderLeft: `4px solid ${color}`, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <div style={{ fontSize: 10, letterSpacing: '.5px', textTransform: 'uppercase' as const, color: TEXT3, marginBottom: 8 }}>{label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: TEXT1, marginBottom: 4 }}>{value}</div>
              <div style={{ fontSize: 10.5, color: TEXT3 }}>{sub}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,2fr)', gap: 12, marginBottom: 20 }}>
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: TEXT1, marginBottom: 2 }}>Discount by Type</div>
              {miniExport(discPie, 'discount_by_type.csv')}
            </div>
            <div style={{ fontSize: 10.5, color: TEXT3, marginBottom: 14 }}>Share of total discount · filtered period</div>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={discPie} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={3} dataKey="value"
                  labelLine={false}
                  label={({ percent }: any) => `${((percent || 0) * 100).toFixed(1)}%`}>
                  {discPie.map((_, i) => <Cell key={i} fill={[TEAL, GOLD, BLUE2][i % 3]} />)}
                </Pie>
                <Tooltip contentStyle={ttStyle}
                  formatter={(v: any) => `${fmt(Number(v))}${discTotal > 0 ? ` · ${((Number(v) / discTotal) * 100).toFixed(1)}% of discount` : ''}`} />
                <Legend formatter={(v) => <span style={{ fontSize: 11, color: TEXT2 }}>{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: TEXT1, marginBottom: 2 }}>Total Discounts by Month</div>
              {miniExport(discChartData, 'total_discounts_by_month.csv')}
            </div>
            <div style={{ fontSize: 10.5, color: TEXT3, marginBottom: 14 }}>Stacked by discount type · filtered period</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={discChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: TEXT3 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: TEXT3 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => fmt(v)} width={55} />
                <Tooltip contentStyle={ttStyle} formatter={(v: any) => fmt(Number(v))} />
                <Legend formatter={(v) => <span style={{ fontSize: 11, color: TEXT2 }}>{v}</span>} />
                <Bar dataKey="Platform Discount" stackId="a" fill={TEAL}  radius={[0,0,0,0]} />
                <Bar dataKey="Seller Discount"   stackId="a" fill={GOLD}  radius={[0,0,0,0]} />
                <Bar dataKey="Shipping Discount" stackId="a" fill={BLUE2} radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* BUYER PERSONAS (admin-only review) */}
        {SHOW_PERSONAS && (
          <>
            {sectionLabel('Buyer Personas', 'buyer-personas')}
            <PersonasTab platform={cPlat} company={cCompany} isAdmin={!!user?.isAdmin} brand={cBrand} category={cCategory} />
          </>
        )}

        {/* AI INSIGHTS */}
        {SHOW_AI_INSIGHTS && (
        <>
        {sectionLabel('AI-Generated Insights')}
        <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 20, marginBottom: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: insights ? 16 : 0 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: TEXT1 }}>Business Insights</div>
              <div style={{ fontSize: 10.5, color: TEXT3, marginTop: 2 }}>AI-powered analysis of your current dashboard data</div>
            </div>
            <button onClick={generateInsights} disabled={insightLoading}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: 'none', background: insightLoading ? '#e2e8f0' : `linear-gradient(135deg, ${TEAL}, ${BLUE2})`, color: insightLoading ? TEXT3 : WHITE, fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: insightLoading ? 'not-allowed' : 'pointer' }}>
              {insightLoading ? '⟳ Generating...' : '✦ Generate Insights'}
            </button>
          </div>
          {insights && (
            <div style={{ fontSize: 13, color: TEXT2, lineHeight: 1.8, whiteSpace: 'pre-wrap' as const, borderTop: `1px solid ${BORDER}`, paddingTop: 16 }}>
              {insights}
            </div>
          )}
          {!insights && !insightLoading && (
            <div style={{ textAlign: 'center' as const, padding: '24px 0', color: TEXT3, fontSize: 12 }}>
              Click "Generate Insights" to get AI-powered analysis of your current data view.
            </div>
          )}
        </div>
        </>
        )}

        <div style={{ fontSize: 10, color: TEXT3, textAlign: 'center' as const, paddingTop: 12, borderTop: `1px solid ${BORDER}` }}>
          Source: GDEC_DATAMART.GOLD_SCHEMA.FACT_PLATFORM_ORDER_ITEMS · Active accounts · GMV: gross ORIGINAL_PRODUCT_PRICE incl. cancelled orders · NMV, orders & units: valid orders only · Geographic data: all time 2023 onwards
        </div>
        </main>
      </div>
      {showChangePw && (
        <ChangePasswordModal onClose={() => setShowChangePw(false)} onSignOut={handleLogout} />
      )}
    </div>
  );
}