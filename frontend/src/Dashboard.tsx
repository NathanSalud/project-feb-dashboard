import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useAuth } from './AuthContext';
import { getKpis, getTimeSeries, getShops, getProducts } from './api';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [cAcc, setCAcc]       = useState('all');
  const [cPlat, setCPlat]     = useState('all');
  const [dateFrom, setDateFrom] = useState('2023-01-01');
  const [dateTo, setDateTo]     = useState('2026-05-31');
  const [activeTab, setActiveTab] = useState<'breakdown'|'shops'|'products'>('breakdown');
  const [granularity, setGranularity] = useState<'day'|'week'|'month'|'quarter'|'year'>('month');

  const qOpts = { dateFrom, dateTo };

  const { data: kpis = [], isFetching: kFetch } = useQuery({
    queryKey: ['kpis', dateFrom, dateTo],
    queryFn: () => getKpis(dateFrom, dateTo).then(r => r.data),
  });

  const { data: timeSeries = [], isFetching: tFetch } = useQuery({
    queryKey: ['timeseries', dateFrom, dateTo],
    queryFn: () => getTimeSeries(dateFrom, dateTo).then(r => r.data),
  });

  const { data: shops = [], isFetching: sFetch } = useQuery({
    queryKey: ['shops', dateFrom, dateTo],
    queryFn: () => getShops(dateFrom, dateTo).then(r => r.data),
  });

  const { data: products = [], isFetching: pFetch } = useQuery({
    queryKey: ['products', dateFrom, dateTo],
    queryFn: () => getProducts(dateFrom, dateTo).then(r => r.data),
  });

  const isLoading = kFetch || tFetch || sFetch || pFetch;

  // Unique filter options
  const platforms = [...new Set(kpis.map((k: any) => k.PLATFORM))] as string[];
  const accounts  = [...new Set(kpis.map((k: any) => k.ACCOUNT_NAME))] as string[];

  // Filter KPIs
  const filteredKpis = kpis.filter((k: any) =>
    (cPlat === 'all' || k.PLATFORM === cPlat) &&
    (cAcc  === 'all' || k.ACCOUNT_NAME === cAcc)
  );

  // Aggregate totals
  const totals = filteredKpis.reduce((acc: any, k: any) => ({
    revenue: (acc.revenue || 0) + Number(k.REVENUE),
    orders:  (acc.orders  || 0) + Number(k.ORDERS),
    items:   (acc.items   || 0) + Number(k.ITEMS),
    pd:      (acc.pd      || 0) + Number(k.PLATFORM_DISCOUNT),
    sd:      (acc.sd      || 0) + Number(k.SELLER_DISCOUNT),
    ship:    (acc.ship    || 0) + Number(k.SHIPPING_DISCOUNT),
  }), {});

  const aov      = totals.orders > 0 ? totals.revenue / totals.orders : 0;
  const discRate = totals.revenue > 0 ? (((totals.pd + totals.sd) / totals.revenue) * 100).toFixed(1) : '0.0';

  // Build time series chart data
  const chartData = (() => {
  const map: Record<string, { revenue: number; orders: number }> = {};
  timeSeries.forEach((r: any) => {
    const platMatch = cPlat === 'all' || r.PLATFORM === cPlat;
    const accMatch  = cAcc  === 'all' || r.ACCOUNT_NAME === cAcc;
    if (!platMatch || !accMatch) return;
    // Support both ORDER_MONTH (old) and ORDER_DATE (new daily cache)
    const dateStr = String(r.ORDER_MONTH || r.ORDER_DATE).slice(0, 7);
    if (!map[dateStr]) map[dateStr] = { revenue: 0, orders: 0 };
    map[dateStr].revenue += Number(r.REVENUE);
    map[dateStr].orders  += Number(r.ORDERS);
  });
  return Object.entries(map)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, d]) => ({
      month: new Date(month + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      revenue: d.revenue,
      orders:  d.orders,
      aov:     d.orders > 0 ? Math.round(d.revenue / d.orders) : 0,
    }));
})();

  // Filtered shops and products
  const filteredShops = shops.filter((s: any) =>
    (cPlat === 'all' || s.PLATFORM === cPlat) &&
    (cAcc  === 'all' || s.ACCOUNT_NAME === cAcc)
  );
  const filteredProducts = products.filter((p: any) =>
    (cPlat === 'all' || p.PLATFORM === cPlat) &&
    (cAcc  === 'all' || p.ACCOUNT_NAME === cAcc)
  );

  const fmt  = (v: number) => v >= 1e9 ? '₱'+(v/1e9).toFixed(1)+'B' : v >= 1e6 ? '₱'+(v/1e6).toFixed(1)+'M' : v >= 1e3 ? '₱'+(v/1e3).toFixed(0)+'K' : '₱'+v.toFixed(0);
  const fmtN = (v: number) => v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1e3 ? (v/1e3).toFixed(0)+'K' : v.toLocaleString();

  const exportCSV = (data: any[], filename: string) => {
    if (!data.length) return;
    const headers = Object.keys(data[0]).join(',');
    const rows = data.map(r => Object.values(r).map(v => `"${v}"`).join(','));
    const blob = new Blob([[headers, ...rows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  };

  const S = {
    page:    { minHeight:'100vh', background:'#0a0c10', color:'#dde1ec', fontFamily:"'Plus Jakarta Sans',sans-serif", fontSize:14, width:'100%' } as React.CSSProperties,
    topbar:  { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'13px 24px', borderBottom:'1px solid rgba(255,255,255,0.06)', background:'#0a0c10', flexWrap:'wrap' as const, gap:10 } as React.CSSProperties,
    icon:    { width:30, height:30, borderRadius:7, background:'linear-gradient(135deg,#4b8ef0,#9b6ff0)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700, color:'#fff' } as React.CSSProperties,
    badge:   { fontSize:11, color:'#454e63', background:'#10131a', border:'1px solid rgba(255,255,255,0.06)', borderRadius:6, padding:'2px 9px' } as React.CSSProperties,
    sel:     { background:'#10131a', border:'1px solid rgba(255,255,255,0.06)', color:'#dde1ec', fontFamily:'inherit', fontSize:12, padding:'5px 10px', borderRadius:8, cursor:'pointer' } as React.CSSProperties,
    drWrap:  { display:'flex', alignItems:'center', gap:6, background:'#10131a', border:'1px solid rgba(255,255,255,0.06)', borderRadius:8, padding:'4px 10px' } as React.CSSProperties,
    drLbl:   { fontSize:10.5, color:'#454e63', whiteSpace:'nowrap' as const } as React.CSSProperties,
    drInp:   { background:'transparent', border:'none', color:'#dde1ec', fontFamily:'inherit', fontSize:12, outline:'none', cursor:'pointer', width:110 } as React.CSSProperties,
    logBtn:  { padding:'5px 12px', borderRadius:7, border:'1px solid rgba(255,255,255,0.06)', fontSize:11.5, fontFamily:'inherit', color:'#e85555', background:'transparent', cursor:'pointer' } as React.CSSProperties,
    content: { padding:'20px 24px' } as React.CSSProperties,
    kg:      { display:'grid', gridTemplateColumns:'repeat(5,minmax(0,1fr))', gap:10, marginBottom:16 } as React.CSSProperties,
    kpi:     { background:'#10131a', border:'1px solid rgba(255,255,255,0.06)', borderRadius:12, padding:'14px 16px' } as React.CSSProperties,
    kl:      { fontSize:10, letterSpacing:'.4px', textTransform:'uppercase' as const, color:'#454e63', marginBottom:8 } as React.CSSProperties,
    kv:      { fontSize:22, fontWeight:700, fontFamily:'JetBrains Mono,monospace', color:'#dde1ec', marginBottom:4 } as React.CSSProperties,
    ks:      { fontSize:10, color:'#454e63' } as React.CSSProperties,
    charts:  { display:'grid', gridTemplateColumns:'repeat(3,minmax(0,1fr))', gap:12, marginBottom:16 } as React.CSSProperties,
    card:    { background:'#10131a', border:'1px solid rgba(255,255,255,0.06)', borderRadius:12, padding:18 } as React.CSSProperties,
    ct:      { fontSize:13, fontWeight:600, color:'#dde1ec', marginBottom:2 } as React.CSSProperties,
    cs:      { fontSize:10.5, color:'#454e63', marginBottom:14 } as React.CSSProperties,
    tabs:    { display:'flex', gap:4, marginBottom:12 } as React.CSSProperties,
    tab:     { padding:'6px 14px', borderRadius:8, border:'1px solid rgba(255,255,255,0.06)', fontSize:12, fontFamily:'inherit', cursor:'pointer', transition:'all .15s' } as React.CSSProperties,
    tbl2:    { width:'100%', borderCollapse:'collapse' as const, fontSize:12 } as React.CSSProperties,
    th:      { fontSize:9.5, letterSpacing:'.4px', textTransform:'uppercase' as const, color:'#454e63', fontWeight:500, padding:'0 0 8px', borderBottom:'1px solid rgba(255,255,255,0.06)', textAlign:'left' as const } as React.CSSProperties,
    td:      { padding:'8px 0', borderBottom:'1px solid rgba(255,255,255,0.06)', color:'#7e879e', verticalAlign:'middle' as const } as React.CSSProperties,
    mono:    { fontFamily:'JetBrains Mono,monospace', fontSize:11, color:'#dde1ec' } as React.CSSProperties,
    expBtn:  { display:'flex', alignItems:'center', gap:5, padding:'5px 11px', borderRadius:7, border:'1px solid rgba(255,255,255,0.06)', fontSize:11, fontFamily:'inherit', color:'#22c98a', background:'transparent', cursor:'pointer' } as React.CSSProperties,
    loading: { display:'flex', alignItems:'center', gap:8, fontSize:12, color:'#454e63', padding:'4px 10px', background:'#10131a', border:'1px solid rgba(255,255,255,0.06)', borderRadius:8 } as React.CSSProperties,
  };

  const tabStyle = (t: string) => ({
    ...S.tab,
    background: activeTab === t ? 'rgba(75,142,240,0.15)' : 'transparent',
    color: activeTab === t ? '#4b8ef0' : '#7e879e',
    borderColor: activeTab === t ? 'rgba(75,142,240,0.3)' : 'rgba(255,255,255,0.06)',
  });

  const ttStyle = { backgroundColor:'#181c26', border:'1px solid rgba(255,255,255,0.08)', borderRadius:8, color:'#dde1ec', fontSize:11 };

  return (
    <div style={S.page}>
      {/* TOPBAR */}
      <header style={S.topbar}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={S.icon}>G</div>
          <div style={{ fontSize:15, fontWeight:700 }}>Account Intelligence</div>
          <div style={S.badge}>{user?.isAdmin ? 'GDEC Admin' : user?.companyName}</div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' as const }}>
          {!user?.isAdmin && accounts.length > 1 && (
            <select style={S.sel} value={cAcc} onChange={e => setCAcc(e.target.value)}>
              <option value="all">All Accounts</option>
              {accounts.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
          {!user?.isAdmin && (
            <select style={S.sel} value={cPlat} onChange={e => setCPlat(e.target.value)}>
              <option value="all">All Platforms</option>
              {platforms.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
          <div style={S.drWrap}>
            <span style={S.drLbl}>From</span>
            <input type="date" style={S.drInp} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            <span style={S.drLbl}>—</span>
            <span style={S.drLbl}>To</span>
            <input type="date" style={S.drInp} value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
          {isLoading && <div style={S.loading}>⟳ Loading...</div>}
          <button style={S.logBtn} onClick={logout}>Sign out</button>
        </div>
      </header>

      <div style={S.content}>
        {/* KPI CARDS */}
        <div style={S.kg}>
          <div style={S.kpi}><div style={S.kl}>Total Revenue</div><div style={S.kv}>{fmt(totals.revenue||0)}</div><div style={S.ks}>ORIGINAL_PRODUCT_PRICE</div></div>
          <div style={S.kpi}><div style={S.kl}>Total Orders</div><div style={S.kv}>{fmtN(totals.orders||0)}</div><div style={S.ks}>Unique platform orders</div></div>
          <div style={S.kpi}><div style={S.kl}>Avg Order Value</div><div style={S.kv}>{fmt(aov)}</div><div style={S.ks}>Revenue ÷ orders</div></div>
          <div style={S.kpi}><div style={S.kl}>Total Discount</div><div style={S.kv}>{fmt((totals.pd||0)+(totals.sd||0))}</div><div style={S.ks}>{discRate}% of revenue</div></div>
          <div style={S.kpi}><div style={S.kl}>Ship. Discount</div><div style={S.kv}>{fmt(totals.ship||0)}</div><div style={S.ks}>Platform absorbed</div></div>
        </div>

        {/* TIME SERIES CHARTS */}
        <div style={S.charts}>
          <div style={S.card}>
            <div style={S.ct}>Revenue by Month</div>
            <div style={S.cs}>Filtered period</div>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="month" tick={{ fontSize:10, fill:'#454e63' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize:10, fill:'#454e63' }} axisLine={false} tickLine={false} tickFormatter={v => fmt(v)} width={55} />
                <Tooltip contentStyle={ttStyle} formatter={(v: any) => fmt(Number(v))} />
                <Line type="monotone" dataKey="revenue" stroke="#4b8ef0" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div style={S.card}>
            <div style={S.ct}>Orders by Month</div>
            <div style={S.cs}>Filtered period</div>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="month" tick={{ fontSize:10, fill:'#454e63' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize:10, fill:'#454e63' }} axisLine={false} tickLine={false} tickFormatter={v => fmtN(v)} width={45} />
                <Tooltip contentStyle={ttStyle} formatter={(v: any) => fmtN(Number(v))+' orders'} />
                <Bar dataKey="orders" fill="rgba(34,201,138,0.6)" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={S.card}>
            <div style={S.ct}>AOV by Month</div>
            <div style={S.cs}>Avg order value · filtered period</div>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="month" tick={{ fontSize:10, fill:'#454e63' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize:10, fill:'#454e63' }} axisLine={false} tickLine={false} tickFormatter={v => fmt(v)} width={55} />
                <Tooltip contentStyle={ttStyle} formatter={(v: any) => fmt(Number(v))} />
                <Line type="monotone" dataKey="aov" stroke="#f0a030" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* GRANULARITY */}
        <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:12 }}>
        <span style={{ fontSize:10, color:'#454e63', letterSpacing:'.4px', textTransform:'uppercase' as const, marginRight:4 }}>Granularity</span>
        {(['day','week','month','quarter','year'] as const).map(g => (
            <button
            key={g}
            onClick={() => g === 'month' && setGranularity(g)}
            style={{
                padding:'4px 10px',
                borderRadius:7,
                border:'1px solid rgba(255,255,255,0.06)',
                fontSize:11,
                fontFamily:'inherit',
                cursor: g === 'month' ? 'pointer' : 'not-allowed',
                background: granularity === g ? 'rgba(75,142,240,0.15)' : 'transparent',
                color: granularity === g ? '#4b8ef0' : g === 'month' ? '#7e879e' : '#2a2f3d',
                borderColor: granularity === g ? 'rgba(75,142,240,0.3)' : 'rgba(255,255,255,0.06)',
                textTransform:'capitalize' as const,
            }}
            title={g !== 'month' ? 'Available in next phase' : ''}
    >
            {g}
            </button>
         ))}
        </div>

        {/* TABS */}
        <div style={S.tabs}>
          <button style={tabStyle('breakdown')} onClick={() => setActiveTab('breakdown')}>Account Breakdown</button>
          <button style={tabStyle('shops')}     onClick={() => setActiveTab('shops')}>Shop Performance</button>
          <button style={tabStyle('products')}  onClick={() => setActiveTab('products')}>Top Products</button>
        </div>

        {/* BREAKDOWN TABLE */}
        {activeTab === 'breakdown' && (
          <div style={S.card}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:14 }}>
              <div><div style={S.ct}>Account & Platform Breakdown</div><div style={S.cs}>Revenue, orders and AOV · active orders · filtered period</div></div>
              <button style={S.expBtn} onClick={() => exportCSV(filteredKpis, 'kpi_breakdown.csv')}>⬇ Export CSV</button>
            </div>
            <div style={{ overflowX:'auto' }}>
              <table style={S.tbl2}>
                <thead><tr>
                  {!user?.isAdmin && <th style={S.th}>Account</th>}
                  <th style={S.th}>Platform</th>
                  <th style={S.th}>Orders</th>
                  <th style={S.th}>Items</th>
                  <th style={{ ...S.th, textAlign:'right' }}>Revenue</th>
                </tr></thead>
                <tbody>
                  {filteredKpis.map((k: any, i: number) => (
                    <tr key={i}>
                      {!user?.isAdmin && <td style={S.td}>{k.ACCOUNT_NAME}</td>}
                      <td style={S.td}>{k.PLATFORM}</td>
                      <td style={{ ...S.td, ...S.mono }}>{fmtN(Number(k.ORDERS))}</td>
                      <td style={{ ...S.td, ...S.mono }}>{fmtN(Number(k.ITEMS))}</td>
                      <td style={{ ...S.td, ...S.mono, textAlign:'right' }}>{fmt(Number(k.REVENUE))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SHOP TABLE */}
        {activeTab === 'shops' && (
          <div style={S.card}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:14 }}>
              <div><div style={S.ct}>Shop Performance</div><div style={S.cs}>Revenue, orders and AOV by SHOP_ID · filtered period</div></div>
              <button style={S.expBtn} onClick={() => exportCSV(filteredShops, 'shop_performance.csv')}>⬇ Export CSV</button>
            </div>
            <div style={{ overflowX:'auto' }}>
              <table style={S.tbl2}>
                <thead><tr>
                  <th style={S.th}>Shop</th>
                  <th style={S.th}>Platform</th>
                  <th style={S.th}>Shop ID</th>
                  <th style={S.th}>Orders</th>
                  <th style={S.th}>Items</th>
                  <th style={{ ...S.th, textAlign:'right' }}>AOV</th>
                  <th style={{ ...S.th, textAlign:'right' }}>Revenue</th>
                </tr></thead>
                <tbody>
                  {filteredShops.map((s: any, i: number) => (
                    <tr key={i}>
                      <td style={S.td}>{s.SHOP_NAME}</td>
                      <td style={S.td}>{s.PLATFORM}</td>
                      <td style={{ ...S.td, fontSize:10, fontFamily:'monospace' }}>{s.SHOP_ID}</td>
                      <td style={{ ...S.td, ...S.mono }}>{fmtN(Number(s.ORDERS))}</td>
                      <td style={{ ...S.td, ...S.mono }}>{fmtN(Number(s.ITEMS))}</td>
                      <td style={{ ...S.td, ...S.mono, textAlign:'right' }}>{fmt(Number(s.AOV))}</td>
                      <td style={{ ...S.td, ...S.mono, textAlign:'right' }}>{fmt(Number(s.REVENUE))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* PRODUCT TABLE */}
        {activeTab === 'products' && (
          <div style={S.card}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:14 }}>
              <div><div style={S.ct}>Top Products</div><div style={S.cs}>Best selling items by revenue · filtered period</div></div>
              <button style={S.expBtn} onClick={() => exportCSV(filteredProducts, 'top_products.csv')}>⬇ Export CSV</button>
            </div>
            <div style={{ overflowX:'auto' }}>
              <table style={S.tbl2}>
                <thead><tr>
                  <th style={S.th}>Product</th>
                  <th style={S.th}>Platform</th>
                  <th style={S.th}>Orders</th>
                  <th style={S.th}>Units</th>
                  <th style={{ ...S.th, textAlign:'right' }}>ASP</th>
                  <th style={{ ...S.th, textAlign:'right' }}>Revenue</th>
                </tr></thead>
                <tbody>
                  {filteredProducts.map((p: any, i: number) => (
                    <tr key={i}>
                      <td style={{ ...S.td, maxWidth:300, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.PRODUCT_NAME}</td>
                      <td style={S.td}>{p.PLATFORM}</td>
                      <td style={{ ...S.td, ...S.mono }}>{fmtN(Number(p.ORDERS))}</td>
                      <td style={{ ...S.td, ...S.mono }}>{fmtN(Number(p.UNITS))}</td>
                      <td style={{ ...S.td, ...S.mono, textAlign:'right' }}>{fmt(Number(p.ASP))}</td>
                      <td style={{ ...S.td, ...S.mono, textAlign:'right' }}>{fmt(Number(p.REVENUE))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}