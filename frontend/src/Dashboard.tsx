import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import { useAuth } from './AuthContext';
import api, { getKpis, getTimeSeries, getShops, getProducts, getGeo, getDiscounts, getDoi } from './api';
import ChangePasswordModal from './ChangePasswordModal';
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
  Shopee: '#f05a28', Lazada: '#1a56db', Tiktok: '#ee1d52',
};
const PIE_COLORS = [TEAL, GOLD, BLUE2, '#22c98a', '#9b6ff0', '#e85555'];

// TODO: replace with real brand list from backend
const STUB_BRANDS = ['Placeholder Brand A', 'Placeholder Brand B', 'Placeholder Brand C'];

export default function Dashboard() {
  // Hidden for now — insights analyze all 2023–2026 data regardless of the user's date
  // filter, so they read as too broad. Re-enable once /insights/generate respects the
  // active date range.
  const SHOW_AI_INSIGHTS = false;
  // UI shell only. No backend brand data yet; the Brand <select> and its `brand`
  // API param are forward-wired and inert until this is flipped on.
  const SHOW_BRAND_FILTER = false;

  const { user, logout } = useAuth();
  const [cAcc, setCAcc]           = useState('all');
  const [cPlat, setCPlat]         = useState('all');
  const [cBrand, setCBrand]       = useState('all');
  const [dateFrom, setDateFrom]   = useState('2023-01-01');
  const [dateTo, setDateTo]       = useState('2026-05-31');
  const [activeTab, setActiveTab] = useState<'breakdown'|'shops'|'products'|'doi'>('breakdown');
  const [granularity, setGranularity] = useState<'day'|'week'|'month'|'quarter'|'year'>('month');
  const [sortCol, setSortCol] = useState<string>('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [insights, setInsights]   = useState<string>('');
  const [insightLoading, setInsightLoading] = useState(false);
  const [doiCustomer, setDoiCustomer] = useState('all');
  const [showChangePw, setShowChangePw] = useState(false);

  const { data: kpis = [], isFetching: kFetch } = useQuery({
    queryKey: ['kpis', dateFrom, dateTo, cBrand],
    queryFn: () => getKpis(dateFrom, dateTo, cBrand).then(r => r.data),
  });
  const { data: timeSeries = [], isFetching: tFetch } = useQuery({
    queryKey: ['timeseries', dateFrom, dateTo, cBrand],
    queryFn: () => getTimeSeries(dateFrom, dateTo, cBrand).then(r => r.data),
  });
  const { data: shopsRes, isFetching: sFetch } = useQuery({
    queryKey: ['shops', dateFrom, dateTo, cBrand],
    queryFn: () => getShops(dateFrom, dateTo, cBrand).then(r => r.data),
  });
  const shops = shopsRes?.data ?? [];
  const { data: productsRes, isFetching: pFetch } = useQuery({
    queryKey: ['products', dateFrom, dateTo, cBrand],
    queryFn: () => getProducts(dateFrom, dateTo, cBrand).then(r => r.data),
  });
  const products = productsRes?.data ?? [];
  const { data: geoRaw = [] } = useQuery({
    queryKey: ['geo'],
    queryFn: () => getGeo().then(r => r.data),
  });
  const { data: discountsRaw = [], isFetching: dFetch } = useQuery({
    queryKey: ['discounts', dateFrom, dateTo, cBrand],
    queryFn: () => getDiscounts(dateFrom, dateTo, cBrand).then(r => r.data),
  });
  const { data: doiRaw = [] } = useQuery({
    queryKey: ['doi'],
    queryFn: () => getDoi().then(r => r.data),
    enabled: !!user, // DOI is now company-scoped server-side; available to every tenant + admin
  });
  const doiCustomers = [...new Set((doiRaw as any[]).map(r => r.CUSTOMER_ID))].sort();
  // Rows are tagged server-side with COMPANY_NAME/ACCOUNT_NAMES. Tenants filter by the
  // global account selector (cAcc); admins keep the raw CUST_ID dropdown.
  const doiFiltered = (doiRaw as any[]).filter(r =>
    (user?.isAdmin ? (doiCustomer === 'all' || r.CUSTOMER_ID === doiCustomer) : true) &&
    (cAcc === 'all' || (r.ACCOUNT_NAMES || []).includes(cAcc))
  );

  const isLoading = kFetch || tFetch || sFetch || pFetch || dFetch;

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
      const av = a[col] ?? 0;
      const bv = b[col] ?? 0;
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  };


  const platforms = [...new Set(kpis.map((k: any) => k.PLATFORM))] as string[];
  const accounts  = [...new Set(kpis.map((k: any) => k.ACCOUNT_NAME))] as string[];

  const filteredKpis = kpis.filter((k: any) =>
    (cPlat === 'all' || k.PLATFORM === cPlat) &&
    (cAcc  === 'all' || k.ACCOUNT_NAME === cAcc) &&
    (user?.isAdmin || user?.accountNames?.includes(k.ACCOUNT_NAME))
  );

  // KPI totals from time series (date-aware)
  const tsRevOrd = timeSeries
    .filter((r: any) =>
      (cPlat === 'all' || r.PLATFORM === cPlat) &&
      (cAcc  === 'all' || r.ACCOUNT_NAME === cAcc) &&
      (user?.isAdmin || user?.accountNames?.includes(r.ACCOUNT_NAME))
    )
    .reduce((acc: any, r: any) => ({
      revenue: (acc.revenue || 0) + Number(r.REVENUE),
      orders:  (acc.orders  || 0) + Number(r.ORDERS),
      items:   (acc.items   || 0) + Number(r.ITEMS),
      pd:      (acc.pd      || 0) + Number(r.PLATFORM_DISCOUNT),
      sd:      (acc.sd      || 0) + Number(r.SELLER_DISCOUNT),
      ship:    (acc.ship    || 0) + Number(r.SHIPPING_DISCOUNT),
    }), {});

  const totals = {
    revenue: tsRevOrd.revenue || 0,
    orders:  tsRevOrd.orders  || 0,
    items:   tsRevOrd.items || 0,
    pd:      tsRevOrd.pd    || 0,
    sd:      tsRevOrd.sd    || 0,
    ship:    tsRevOrd.ship  || 0,
  };
  const aov      = totals.orders > 0 ? totals.revenue / totals.orders : 0;
  const discRate = totals.revenue > 0 ? (((totals.pd + totals.sd) / totals.revenue) * 100).toFixed(1) : '0.0';

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

  type PerPlat = {revenue:number;orders:number;items:number};
  const chartData = (() => {
    const map: Record<string, {revenue:number;orders:number;items:number;plat:Record<string,PerPlat>}> = {};
    timeSeries.forEach((r: any) => {
      if((cPlat !== 'all' && r.PLATFORM !== cPlat) || (cAcc !== 'all' && r.ACCOUNT_NAME !== cAcc)) return;
      const raw = r.ORDER_DATE instanceof Date ? r.ORDER_DATE.toISOString().slice(0,10) : String(r.ORDER_DATE||r.ORDER_MONTH).slice(0,10);
      const key = groupKey(raw);
      if(!map[key]) map[key] = {revenue:0,orders:0,items:0,plat:{}};
      const m = map[key];
      m.revenue += Number(r.REVENUE);
      m.orders  += Number(r.ORDERS);
      m.items   += Number(r.ITEMS);
      const p = r.PLATFORM;
      if(!m.plat[p]) m.plat[p] = {revenue:0,orders:0,items:0};
      m.plat[p].revenue += Number(r.REVENUE);
      m.plat[p].orders  += Number(r.ORDERS);
      m.plat[p].items   += Number(r.ITEMS);
    });
    return Object.entries(map).sort((a,b)=>a[0].localeCompare(b[0])).map(([k,d])=>{
      const row: Record<string, any> = {
        month: granularity === 'month' ? new Date(k+'-01').toLocaleDateString('en-US',{month:'short',year:'2-digit'})
             : granularity === 'year'  ? k
             : granularity === 'quarter' ? k
             : new Date(k).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit'}),
        revenue: d.revenue, orders: d.orders, items: d.items,
        aov: d.orders > 0 ? Math.round(d.revenue/d.orders) : 0,
      };
      for(const [p, pv] of Object.entries(d.plat)) {
        row[`revenue__${p}`] = pv.revenue;
        row[`orders__${p}`]  = pv.orders;
        row[`items__${p}`]   = pv.items;
        row[`aov__${p}`]     = pv.orders > 0 ? Math.round(pv.revenue/pv.orders) : 0;
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

  // Sales by platform pie
  const platPie = (() => {
    const map: Record<string, number> = {};
    filteredKpis.forEach((k: any) => {
      map[k.PLATFORM] = (map[k.PLATFORM]||0) + Number(k.REVENUE);
    });
    return Object.entries(map).map(([name, value]) => ({name, value}));
  })();

  // Geo data
  const geoData = (() => {
    const filtered = geoRaw.filter((r: any) =>
      (cPlat === 'all' || r.PLATFORM === cPlat) &&
      (cAcc  === 'all' || r.ACCOUNT_NAME === cAcc) &&
      (user?.isAdmin || user?.accountNames?.includes(r.ACCOUNT_NAME))
    );
    const map: Record<string, number> = {};
    filtered.forEach((r: any) => {
      map[r.SHIPPING_PROVINCE] = (map[r.SHIPPING_PROVINCE]||0) + Number(r.REVENUE);
    });
    return Object.entries(map)
      .sort((a,b) => b[1]-a[1])
      .slice(0,15)
      .map(([name, value]) => ({name, value}));
  })();

  // Discount time series
  const discChartData = (() => {
    const map: Record<string, {pd:number;sd:number;ship:number;sship:number}> = {};
    discountsRaw.forEach((r: any) => {
      if((cPlat !== 'all' && r.PLATFORM !== cPlat) || (cAcc !== 'all' && r.ACCOUNT_NAME !== cAcc)) return;
      if(!user?.isAdmin && !user?.accountNames?.includes(r.ACCOUNT_NAME)) return;
      const raw = r.ORDER_DATE instanceof Date ? r.ORDER_DATE.toISOString().slice(0,10) : String(r.ORDER_DATE).slice(0,10);
      const key = groupKey(raw);
      if(!map[key]) map[key] = {pd:0,sd:0,ship:0,sship:0};
      map[key].pd    += Number(r.PLATFORM_DISCOUNT||0);
      map[key].sd    += Number(r.SELLER_DISCOUNT||0);
      map[key].ship  += Number(r.SHIPPING_DISCOUNT||0);
      map[key].sship += Number(r.SELLER_SHIPPING_DISCOUNT||0);
    });
    return Object.entries(map).sort((a,b)=>a[0].localeCompare(b[0])).map(([k,d])=>({
      month: granularity === 'month' ? new Date(k+'-01').toLocaleDateString('en-US',{month:'short',year:'2-digit'}) : k,
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

  const fmt  = (v: number) => v>=1e9?'₱'+(v/1e9).toFixed(1)+'B':v>=1e6?'₱'+(v/1e6).toFixed(1)+'M':v>=1e3?'₱'+(v/1e3).toFixed(0)+'K':'₱'+v.toFixed(0);
  const fmtN = (v: number) => v>=1e6?(v/1e6).toFixed(1)+'M':v>=1e3?(v/1e3).toFixed(0)+'K':v.toLocaleString();

  const exportCSV = (data: any[], filename: string) => {
    if(!data.length) return;
    const headers = Object.keys(data[0]).join(',');
    const rows = data.map(r => Object.values(r).map(v => `"${v}"`).join(','));
    const blob = new Blob([[headers,...rows].join('\n'),], {type:'text/csv'});
    const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click();
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

  const filteredShops    = shops.filter((s: any) => (cPlat==='all'||s.PLATFORM===cPlat)&&(cAcc==='all'||s.ACCOUNT_NAME===cAcc));
  const filteredProducts = products.filter((p: any) => (cPlat==='all'||p.PLATFORM===cPlat)&&(cAcc==='all'||p.ACCOUNT_NAME===cAcc));

  const ttStyle = { backgroundColor: WHITE, border: `1px solid ${BORDER}`, borderRadius: 8, color: TEXT1, fontSize: 11 };

  const kpiCard = (label: string, value: string, sub: string, accent: string) => (
    <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '16px 20px', borderTop: `3px solid ${accent}`, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <div style={{ fontSize: 10, letterSpacing: '.5px', textTransform: 'uppercase' as const, color: TEXT3, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: TEXT1, marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: 10.5, color: TEXT3 }}>{sub}</div>
    </div>
  );

  const sectionLabel = (text: string, id?: string) => (
    <div id={id} style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase' as const, color: TEXT3, marginBottom: 12, marginTop: 8, paddingBottom: 8, borderBottom: `1px solid ${BORDER}`, scrollMarginTop: 80 }}>{text}</div>
  );

  return (
    <div style={{ minHeight: '100vh', background: LIGHT, color: TEXT1, fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 14 }}>

      {/* TOPBAR */}
      <header style={{ position: 'sticky' as const, top: 0, zIndex: 30, background: WHITE, borderBottom: `1px solid ${BORDER}`, padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 60, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', flexWrap: 'wrap' as const, gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src={gdecLogo} alt="GDEC" style={{ height: 36, objectFit: 'contain' }} />
          <div style={{ width: 1, height: 28, background: BORDER }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: TEAL }}>Account Intelligence</div>
            <div style={{ fontSize: 10, color: TEXT3 }}>{user?.isAdmin ? 'Admin View — All Companies' : (user?.displayName ?? user?.companyName)}</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
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
          {SHOW_BRAND_FILTER && (
            <select onChange={e => setCBrand(e.target.value)} value={cBrand} style={{ background: WHITE, border: `1px solid ${BORDER}`, color: TEXT1, fontFamily: 'inherit', fontSize: 12, padding: '5px 10px', borderRadius: 8, cursor: 'pointer' }}>
              <option value="all">All Brands</option>
              {STUB_BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '4px 10px' }}>
            <span style={{ fontSize: 10.5, color: TEXT3 }}>From</span>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ background: 'transparent', border: 'none', color: TEXT1, fontFamily: 'inherit', fontSize: 12, outline: 'none', width: 110 }} />
            <span style={{ color: TEXT3 }}>—</span>
            <span style={{ fontSize: 10.5, color: TEXT3 }}>To</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ background: 'transparent', border: 'none', color: TEXT1, fontFamily: 'inherit', fontSize: 12, outline: 'none', width: 110 }} />
          </div>
          {isLoading && <span style={{ fontSize: 11, color: TEAL }}>⟳ Loading...</span>}
          <button onClick={logout} style={{ padding: '5px 14px', borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 12, fontFamily: 'inherit', color: '#e85555', background: WHITE, cursor: 'pointer' }}>Sign out</button>
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
              { id: 'data-tables',          label: 'Data Tables' },
              { id: 'geographic-platform',  label: 'Geographic & Platform' },
              { id: 'discount-analysis',    label: 'Discount Analysis' },
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0,1fr))', gap: 12, marginBottom: 20 }}>
          {kpiCard('Total Revenue',   fmt(totals.revenue), 'ORIGINAL_PRODUCT_PRICE · filtered period', TEAL)}
          {kpiCard('Total Orders',    fmtN(totals.orders), 'Unique platform orders',                   GOLD)}
          {kpiCard('Avg Order Value', fmt(aov),            'Revenue ÷ orders',                         BLUE2)}
          {kpiCard('Items Sold',      fmtN(totals.items),  'Order line items',                         '#22c98a')}
          {kpiCard('Discount Rate',   discRate + '%',       'Of original product price',               '#9b6ff0')}
        </div>

        {/* TIME SERIES CHARTS */}
        {sectionLabel('Trends', 'trends')}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          <span style={{ fontSize: 10, color: TEXT3, letterSpacing: '.4px', textTransform: 'uppercase' as const, marginRight: 4 }}>Granularity</span>
          {(['day','week','month','quarter','year'] as const).map(g => (
            <button key={g} onClick={() => setGranularity(g)}
              style={{ padding: '4px 10px', borderRadius: 7, border: `1px solid ${granularity===g ? TEAL : BORDER}`, fontSize: 11, fontFamily: 'inherit', cursor: 'pointer', background: granularity===g ? `rgba(26,122,138,0.1)` : WHITE, color: granularity===g ? TEAL : TEXT2, textTransform: 'capitalize' as const }}
              title={g !== 'month' ? 'Available in next phase' : ''}>{g}</button>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 12, marginBottom: 20 }}>
          {[
            { title: 'Revenue by Month',    key: 'revenue', color: TEAL,      type: 'line', fmt: fmt,  suffix: '' },
            { title: 'Orders by Month',     key: 'orders',  color: '#22c98a', type: 'bar',  fmt: fmtN, suffix: ' orders' },
            { title: 'AOV by Month',        key: 'aov',     color: GOLD,      type: 'line', fmt: fmt,  suffix: '' },
            { title: 'Items Sold by Month', key: 'items',   color: BLUE2,     type: 'bar',  fmt: fmtN, suffix: ' items' },
          ].map(({ title, key, color, type, fmt: f, suffix }) => {
            const split = splitPlats.length > 0;
            return (
            <div key={key} style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: TEXT1, marginBottom: 2 }}>{title}</div>
              <div style={{ fontSize: 10.5, color: TEXT3, marginBottom: 14 }}>Filtered period</div>
              <ResponsiveContainer width="100%" height={160}>
                {type === 'line' ? (
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

        {/* TABS + TABLES */}
        {sectionLabel('Data Tables', 'data-tables')}
        <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
          {(['breakdown','shops','products','doi'] as const).map(t => (
            <button key={t} onClick={() => { setActiveTab(t); setSortCol(''); setSortDir('asc'); }} style={{ padding: '6px 16px', borderRadius: 8, border: `1px solid ${activeTab===t ? TEAL : BORDER}`, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer', background: activeTab===t ? `rgba(26,122,138,0.08)` : WHITE, color: activeTab===t ? TEAL : TEXT2, fontWeight: activeTab===t ? 600 : 400, textTransform: 'capitalize' as const }}>
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
                {activeTab === 'breakdown' ? 'Revenue, orders and AOV · filtered period' : activeTab === 'shops' ? 'Revenue, orders and AOV · filtered period' : activeTab === 'products' ? 'Best selling items by revenue · filtered period' : 'Current stock levels vs. 90-day order velocity · independent of date filters · inventory is at warehouse-customer grain; accounts sharing a warehouse customer show combined inventory'}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {activeTab === 'doi' && user?.isAdmin && (
  <select value={doiCustomer} onChange={e => setDoiCustomer(e.target.value)}
    style={{ marginRight: 8, padding: '5px 10px', borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 11, fontFamily: 'inherit', color: TEXT2, background: WHITE, cursor: 'pointer' }}>
    <option value="all">All customers</option>
    {doiCustomers.map(c => <option key={c} value={c}>{c}</option>)}
  </select>
)}<button onClick={() => exportCSV(activeTab==='breakdown'?filteredKpis:activeTab==='shops'?filteredShops:activeTab==='products'?filteredProducts:doiFiltered, `${activeTab}.csv`)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 11, fontFamily: 'inherit', color: '#22c98a', background: WHITE, cursor: 'pointer' }}>
              ⬇ Export CSV
            </button>
            </div>
          </div>
          <div style={{ overflowX: 'auto', maxHeight: 500, overflowY: 'auto' }}>
            {activeTab === 'breakdown' && (
              <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 }}>
                <thead><tr>
                  {!user?.isAdmin && <th style={{ fontSize: 9.5, color: TEXT3, fontWeight: 500, padding: '0 0 10px', borderBottom: `1px solid ${BORDER}`, textAlign: 'left' as const }}>Account</th>}
                  <th style={{ fontSize: 9.5, color: TEXT3, fontWeight: 500, padding: '0 0 10px', borderBottom: `1px solid ${BORDER}`, textAlign: 'left' as const }}>Platform</th>
                  <th style={{ fontSize: 9.5, color: TEXT3, fontWeight: 500, padding: '0 0 10px', borderBottom: `1px solid ${BORDER}`, textAlign: 'left' as const }}>Orders</th>
                  <th style={{ fontSize: 9.5, color: TEXT3, fontWeight: 500, padding: '0 0 10px', borderBottom: `1px solid ${BORDER}`, textAlign: 'left' as const }}>Items</th>
                  <th style={{ fontSize: 9.5, color: TEXT3, fontWeight: 500, padding: '0 0 10px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' as const }}>Revenue</th>
                </tr></thead>
                <tbody>
                  {filteredKpis.map((k: any, i: number) => (
                    <tr key={i} style={{ background: i%2===0 ? WHITE : '#fafbfc' }}>
                      {!user?.isAdmin && <td style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}`, color: TEXT2 }}>{k.ACCOUNT_NAME}</td>}
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
                  {['Shop','Platform','Shop ID','Orders','Items','AOV','Revenue'].map((h,i) => (
                    <th key={h} style={{ fontSize: 9.5, color: TEXT3, fontWeight: 500, padding: '0 0 10px', borderBottom: `1px solid ${BORDER}`, textAlign: i>=3?'right' as const:'left' as const }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {filteredShops.map((s: any, i: number) => (
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
                  {['Product','Platform','Orders','Units','ASP','Revenue'].map((h,i) => (
                    <th key={h} style={{ fontSize: 9.5, color: TEXT3, fontWeight: 500, padding: '0 0 10px', borderBottom: `1px solid ${BORDER}`, textAlign: i>=2?'right' as const:'left' as const }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {filteredProducts.map((p: any, i: number) => (
                    <tr key={i} style={{ background: i%2===0 ? WHITE : '#fafbfc' }}>
                      <td style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}`, color: TEXT1, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{p.PRODUCT_NAME}</td>
                      <td style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}` }}><span style={{ background: `${PLAT_COLORS[p.PLATFORM]||TEAL}18`, color: PLAT_COLORS[p.PLATFORM]||TEAL, padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600 }}>{p.PLATFORM}</span></td>
                      <td style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}`, color: TEXT2, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, textAlign: 'right' as const }}>{fmtN(Number(p.ORDERS))}</td>
                      <td style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}`, color: TEXT2, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, textAlign: 'right' as const }}>{fmtN(Number(p.UNITS))}</td>
                      <td style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}`, color: TEXT2, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, textAlign: 'right' as const }}>{fmt(Number(p.ASP))}</td>
                      <td style={{ padding: '9px 0', borderBottom: `1px solid ${BORDER}`, color: TEXT1, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, textAlign: 'right' as const, fontWeight: 600 }}>{fmt(Number(p.REVENUE))}</td>
                    </tr>
                  ))}
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
            <div style={{ fontSize: 13, fontWeight: 600, color: TEXT1, marginBottom: 2 }}>Sales by Platform</div>
            <div style={{ fontSize: 10.5, color: TEXT3, marginBottom: 14 }}>Revenue share · filtered period</div>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={platPie} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                  {platPie.map((_, i) => <Cell key={i} fill={PLAT_COLORS[platPie[i]?.name] || PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={ttStyle} formatter={(v: any) => fmt(Number(v))} />
                <Legend formatter={(v) => <span style={{ fontSize: 11, color: TEXT2 }}>{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: TEXT1, marginBottom: 2 }}>Sales by Province</div>
            <div style={{ fontSize: 10.5, color: TEXT3, marginBottom: 14 }}>Top 15 provinces by revenue · all time · 2023 onwards</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={geoData} layout="vertical" margin={{ left: 90 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: TEXT3 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => fmt(v)} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: TEXT2 }} axisLine={false} tickLine={false} width={85} />
                <Tooltip contentStyle={ttStyle} formatter={(v: any) => fmt(Number(v))} />
                <Bar dataKey="value" fill={TEAL} radius={[0,3,3,0]} opacity={0.85} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* DISCOUNT SECTION */}
        {sectionLabel('Discount Analysis', 'discount-analysis')}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 12, marginBottom: 16 }}>
          {[
            { label: 'Platform Discount', value: fmt(totals.pd),         sub: `${totals.revenue>0?((totals.pd/totals.revenue)*100).toFixed(1):0}% of revenue`, color: TEAL },
            { label: 'Seller Discount',   value: fmt(totals.sd),         sub: `${totals.revenue>0?((totals.sd/totals.revenue)*100).toFixed(1):0}% of revenue`, color: GOLD },
            { label: 'Shipping Discount', value: fmt(totals.ship),       sub: `${totals.revenue>0?((totals.ship/totals.revenue)*100).toFixed(1):0}% of revenue`, color: BLUE2 },
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
            <div style={{ fontSize: 13, fontWeight: 600, color: TEXT1, marginBottom: 2 }}>Discount by Type</div>
            <div style={{ fontSize: 10.5, color: TEXT3, marginBottom: 14 }}>Share of total discount · filtered period</div>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={discPie} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={3} dataKey="value">
                  {discPie.map((_, i) => <Cell key={i} fill={[TEAL, GOLD, BLUE2][i % 3]} />)}
                </Pie>
                <Tooltip contentStyle={ttStyle} formatter={(v: any) => fmt(Number(v))} />
                <Legend formatter={(v) => <span style={{ fontSize: 11, color: TEXT2 }}>{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: TEXT1, marginBottom: 2 }}>Total Discounts by Month</div>
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
          Source: GDEC_DATAMART.GOLD_SCHEMA.FACT_PLATFORM_ORDER_ITEMS · Active accounts · Revenue: ORIGINAL_PRODUCT_PRICE · Geographic data: all time 2023 onwards
        </div>
        </main>
      </div>
      {showChangePw && (
        <ChangePasswordModal onClose={() => setShowChangePw(false)} onSignOut={logout} />
      )}
    </div>
  );
}