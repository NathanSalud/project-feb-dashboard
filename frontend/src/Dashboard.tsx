import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import { useAuth } from './AuthContext';
import { getKpis, getTimeSeries, getShops, getProducts, getGeo, getDiscounts } from './api';
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

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [cAcc, setCAcc]           = useState('all');
  const [cPlat, setCPlat]         = useState('all');
  const [dateFrom, setDateFrom]   = useState('2023-01-01');
  const [dateTo, setDateTo]       = useState('2026-05-31');
  const [activeTab, setActiveTab] = useState<'breakdown'|'shops'|'products'>('breakdown');
  const [granularity, setGranularity] = useState<'day'|'week'|'month'|'quarter'|'year'>('month');
  const [insights, setInsights]   = useState<string>('');
  const [insightLoading, setInsightLoading] = useState(false);

  const { data: kpis = [], isFetching: kFetch } = useQuery({
    queryKey: ['kpis', dateFrom, dateTo],
    queryFn: () => getKpis(dateFrom, dateTo).then(r => r.data),
  });
  const { data: timeSeries = [], isFetching: tFetch } = useQuery({
    queryKey: ['timeseries', dateFrom, dateTo],
    queryFn: () => getTimeSeries(dateFrom, dateTo).then(r => r.data),
  });
  const { data: shopsRes, isFetching: sFetch } = useQuery({
    queryKey: ['shops', dateFrom, dateTo],
    queryFn: () => getShops(dateFrom, dateTo).then(r => r.data),
  });
  const shops = shopsRes?.data ?? [];
  const { data: productsRes, isFetching: pFetch } = useQuery({
    queryKey: ['products', dateFrom, dateTo],
    queryFn: () => getProducts(dateFrom, dateTo).then(r => r.data),
  });
  const products = productsRes?.data ?? [];
  const { data: geoRaw = [] } = useQuery({
    queryKey: ['geo'],
    queryFn: () => getGeo().then(r => r.data),
  });
  const { data: discountsRaw = [], isFetching: dFetch } = useQuery({
    queryKey: ['discounts', dateFrom, dateTo],
    queryFn: () => getDiscounts(dateFrom, dateTo).then(r => r.data),
  });

  const isLoading = kFetch || tFetch || sFetch || pFetch || dFetch;

  const platforms = [...new Set(kpis.map((k: any) => k.PLATFORM))] as string[];
  const accounts  = [...new Set(kpis.map((k: any) => k.ACCOUNT_NAME))] as string[];

  const filteredKpis = kpis.filter((k: any) =>
    (cPlat === 'all' || k.PLATFORM === cPlat) &&
    (cAcc  === 'all' || k.ACCOUNT_NAME === cAcc)
  );

  // KPI totals from time series (date-aware)
  const tsRevOrd = timeSeries
    .filter((r: any) =>
      (cPlat === 'all' || r.PLATFORM === cPlat) &&
      (cAcc  === 'all' || r.ACCOUNT_NAME === cAcc)
    )
    .reduce((acc: any, r: any) => ({
      revenue: (acc.revenue || 0) + Number(r.REVENUE),
      orders:  (acc.orders  || 0) + Number(r.ORDERS),
    }), {});

  const kpiBase = filteredKpis.reduce((acc: any, k: any) => ({
    revenue: (acc.revenue || 0) + Number(k.REVENUE),
    pd:      (acc.pd      || 0) + Number(k.PLATFORM_DISCOUNT),
    sd:      (acc.sd      || 0) + Number(k.SELLER_DISCOUNT),
    ship:    (acc.ship    || 0) + Number(k.SHIPPING_DISCOUNT),
    items:   (acc.items   || 0) + Number(k.ITEMS),
  }), {});

  const discRatio = kpiBase.revenue > 0 ? (tsRevOrd.revenue || 0) / kpiBase.revenue : 1;
  const totals = {
    revenue: tsRevOrd.revenue || 0,
    orders:  tsRevOrd.orders  || 0,
    items:   Math.round((kpiBase.items || 0) * discRatio),
    pd:      (kpiBase.pd   || 0) * discRatio,
    sd:      (kpiBase.sd   || 0) * discRatio,
    ship:    (kpiBase.ship || 0) * discRatio,
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

  const chartData = (() => {
    const map: Record<string, {revenue:number;orders:number}> = {};
    timeSeries.forEach((r: any) => {
      if((cPlat !== 'all' && r.PLATFORM !== cPlat) || (cAcc !== 'all' && r.ACCOUNT_NAME !== cAcc)) return;
      const raw = r.ORDER_DATE instanceof Date ? r.ORDER_DATE.toISOString().slice(0,10) : String(r.ORDER_DATE||r.ORDER_MONTH).slice(0,10);
      const key = groupKey(raw);
      if(!map[key]) map[key] = {revenue:0,orders:0};
      map[key].revenue += Number(r.REVENUE);
      map[key].orders  += Number(r.ORDERS);
    });
    return Object.entries(map).sort((a,b)=>a[0].localeCompare(b[0])).map(([k,d])=>({
      month: granularity === 'month' ? new Date(k+'-01').toLocaleDateString('en-US',{month:'short',year:'2-digit'})
           : granularity === 'year'  ? k
           : granularity === 'quarter' ? k
           : new Date(k).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit'}),
      revenue: d.revenue, orders: d.orders,
      aov: d.orders > 0 ? Math.round(d.revenue/d.orders) : 0,
    }));
  })();

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
      (cAcc  === 'all' || r.ACCOUNT_NAME === cAcc)
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
    setInsightLoading(true);
    setInsights('');
    const summary = {
      company:    user?.isAdmin ? 'All Companies (GDEC Admin)' : user?.companyName,
      dateRange:  `${dateFrom} to ${dateTo}`,
      filters:    { account: cAcc, platform: cPlat },
      kpis: {
        totalRevenue:    fmt(totals.revenue),
        totalOrders:     fmtN(totals.orders),
        aov:             fmt(aov),
        discountRate:    discRate + '%',
        totalDiscount:   fmt(totals.pd + totals.sd),
        shippingDiscount: fmt(totals.ship),
      },
      topPlatform:   platPie.sort((a,b)=>b.value-a.value)[0]?.name || 'N/A',
      topProvince:   geoData[0]?.name || 'N/A',
      chartTrend:    chartData.length > 1
        ? (chartData[chartData.length-1].revenue > chartData[0].revenue ? 'upward' : 'downward')
        : 'insufficient data',
    };

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages: [{
            role: 'user',
            content: `You are a senior business analyst for Great Deals E-Commerce Corp (GDEC), a Philippine e-commerce enabler managing brand stores on Shopee, Lazada, and TikTok Shop.

Analyze this dashboard data and provide 5-6 concise, actionable business insights in plain English. Focus on what the numbers mean for the business, not just what they are. Flag risks, opportunities, and recommended next actions. Be direct and executive-ready.

Dashboard data:
${JSON.stringify(summary, null, 2)}

Format your response as a numbered list. Each insight should be 2-3 sentences maximum.`
          }]
        })
      });
      const data = await res.json();
      const text = data.content?.[0]?.text || 'Unable to generate insights at this time.';
      setInsights(text);
    } catch {
      setInsights('Unable to generate insights. Please check your connection and try again.');
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

  const sectionLabel = (text: string) => (
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase' as const, color: TEXT3, marginBottom: 12, marginTop: 8, paddingBottom: 8, borderBottom: `1px solid ${BORDER}` }}>{text}</div>
  );

  return (
    <div style={{ minHeight: '100vh', background: LIGHT, color: TEXT1, fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 14 }}>

      {/* TOPBAR */}
      <header style={{ background: WHITE, borderBottom: `1px solid ${BORDER}`, padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 60, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', flexWrap: 'wrap' as const, gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src={gdecLogo} alt="GDEC" style={{ height: 36, objectFit: 'contain' }} />
          <div style={{ width: 1, height: 28, background: BORDER }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: TEAL }}>Account Intelligence</div>
            <div style={{ fontSize: 10, color: TEXT3 }}>{user?.isAdmin ? 'Admin View — All Companies' : user?.companyName}</div>
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
            <select onChange={e => setCPlat(e.target.value)} value={cPlat} style={{ background: WHITE, border: `1px solid ${BORDER}`, color: TEXT1, fontFamily: 'inherit', fontSize: 12, padding: '5px 10px', borderRadius: 8, cursor: 'pointer' }}>
              <option value="all">All Platforms</option>
              {platforms.map(p => <option key={p} value={p}>{p}</option>)}
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

      <div style={{ padding: '20px 24px' }}>

        {/* KPI CARDS */}
        {sectionLabel('Performance Overview')}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0,1fr))', gap: 12, marginBottom: 20 }}>
          {kpiCard('Total Revenue',   fmt(totals.revenue), 'ORIGINAL_PRODUCT_PRICE · filtered period', TEAL)}
          {kpiCard('Total Orders',    fmtN(totals.orders), 'Unique platform orders',                   GOLD)}
          {kpiCard('Avg Order Value', fmt(aov),            'Revenue ÷ orders',                         BLUE2)}
          {kpiCard('Items Sold',      fmtN(totals.items),  'Order line items · estimated',             '#22c98a')}
          {kpiCard('Discount Rate',   discRate + '%',       'Of original product price',               '#9b6ff0')}
        </div>

        {/* TIME SERIES CHARTS */}
        {sectionLabel('Trends')}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          <span style={{ fontSize: 10, color: TEXT3, letterSpacing: '.4px', textTransform: 'uppercase' as const, marginRight: 4 }}>Granularity</span>
          {(['day','week','month','quarter','year'] as const).map(g => (
            <button key={g} onClick={() => setGranularity(g)}
              style={{ padding: '4px 10px', borderRadius: 7, border: `1px solid ${granularity===g ? TEAL : BORDER}`, fontSize: 11, fontFamily: 'inherit', cursor: 'pointer', background: granularity===g ? `rgba(26,122,138,0.1)` : WHITE, color: granularity===g ? TEAL : TEXT2, textTransform: 'capitalize' as const }}
              title={g !== 'month' ? 'Available in next phase' : ''}>{g}</button>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 12, marginBottom: 20 }}>
          {[
            { title: 'Revenue by Month', key: 'revenue', color: TEAL, type: 'line', fmt: fmt },
            { title: 'Orders by Month',  key: 'orders',  color: '#22c98a', type: 'bar', fmt: fmtN },
            { title: 'AOV by Month',     key: 'aov',     color: GOLD, type: 'line', fmt: fmt },
          ].map(({ title, key, color, type, fmt: f }) => (
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
                    <Line type="monotone" dataKey={key} stroke={color} strokeWidth={2} dot={false} />
                  </LineChart>
                ) : (
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: TEXT3 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10, fill: TEXT3 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => f(v)} width={45} />
                    <Tooltip contentStyle={ttStyle} formatter={(v: any) => f(Number(v)) + ' orders'} />
                    <Bar dataKey={key} fill={color} radius={[3,3,0,0]} opacity={0.8} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          ))}
        </div>

        {/* TABS + TABLES */}
        {sectionLabel('Data Tables')}
        <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
          {(['breakdown','shops','products'] as const).map(t => (
            <button key={t} onClick={() => setActiveTab(t)} style={{ padding: '6px 16px', borderRadius: 8, border: `1px solid ${activeTab===t ? TEAL : BORDER}`, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer', background: activeTab===t ? `rgba(26,122,138,0.08)` : WHITE, color: activeTab===t ? TEAL : TEXT2, fontWeight: activeTab===t ? 600 : 400, textTransform: 'capitalize' as const }}>
              {t === 'breakdown' ? 'Account Breakdown' : t === 'shops' ? 'Shop Performance' : 'Top Products'}
            </button>
          ))}
        </div>

        <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 20, marginBottom: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: TEXT1 }}>
                {activeTab === 'breakdown' ? 'Account & Platform Breakdown' : activeTab === 'shops' ? 'Shop Performance' : 'Top Products by Revenue'}
              </div>
              <div style={{ fontSize: 10.5, color: TEXT3, marginTop: 2 }}>
                {activeTab === 'breakdown' ? 'Revenue, orders and AOV · filtered period' : activeTab === 'shops' ? 'Revenue, orders and AOV by SHOP_ID' : 'Best selling items by revenue · filtered period'}
              </div>
            </div>
            <button onClick={() => exportCSV(activeTab==='breakdown'?filteredKpis:activeTab==='shops'?filteredShops:filteredProducts, `${activeTab}.csv`)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 11, fontFamily: 'inherit', color: '#22c98a', background: WHITE, cursor: 'pointer' }}>
              ⬇ Export CSV
            </button>
          </div>
          <div style={{ overflowX: 'auto' }}>
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
          </div>
        </div>

        {/* SALES BY PLATFORM + PROVINCE */}
        {sectionLabel('Geographic & Platform Distribution')}
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
        {sectionLabel('Discount Analysis')}
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

        <div style={{ fontSize: 10, color: TEXT3, textAlign: 'center' as const, paddingTop: 12, borderTop: `1px solid ${BORDER}` }}>
          Source: GDEC_DATAMART.GOLD_SCHEMA.FACT_PLATFORM_ORDER_ITEMS · Active accounts · Revenue: ORIGINAL_PRODUCT_PRICE · Geographic data: all time 2023 onwards
        </div>
      </div>
    </div>
  );
}