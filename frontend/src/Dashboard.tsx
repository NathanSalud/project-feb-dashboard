import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from './AuthContext';
import { getKpis, getTimeSeries, getShops, getProducts } from './api';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [cAcc, setCAcc] = useState('all');
  const [cPlat, setCPlat] = useState('all');
  const [dateFrom, setDateFrom] = useState('2023-01-01');
  const [dateTo, setDateTo] = useState('2026-05-31');

  const { data: kpis = [] } = useQuery({
    queryKey: ['kpis'],
    queryFn: () => getKpis().then(r => r.data),
  });

  const { data: timeSeries = [] } = useQuery({
    queryKey: ['timeseries'],
    queryFn: () => getTimeSeries().then(r => r.data),
  });

  const { data: shops = [] } = useQuery({
    queryKey: ['shops'],
    queryFn: () => getShops().then(r => r.data),
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: () => getProducts().then(r => r.data),
  });

  // Get unique platforms and accounts for filters
  const platforms = user?.isAdmin
    ? []
    : [...new Set(kpis.map((k: any) => k.PLATFORM))];

  const accounts = user?.isAdmin
    ? []
    : [...new Set(kpis.map((k: any) => k.ACCOUNT_NAME))];

  // Filter KPIs based on selections
  const filteredKpis = kpis.filter((k: any) => {
    const platMatch = cPlat === 'all' || k.PLATFORM === cPlat;
    const accMatch  = cAcc  === 'all' || k.ACCOUNT_NAME === cAcc;
    return platMatch && accMatch;
  });

  // Aggregate totals
  const totals = filteredKpis.reduce((acc: any, k: any) => ({
    revenue:  (acc.revenue  || 0) + Number(k.REVENUE),
    orders:   (acc.orders   || 0) + Number(k.ORDERS),
    items:    (acc.items    || 0) + Number(k.ITEMS),
    pd:       (acc.pd       || 0) + Number(k.PLATFORM_DISCOUNT),
    sd:       (acc.sd       || 0) + Number(k.SELLER_DISCOUNT),
    ship:     (acc.ship     || 0) + Number(k.SHIPPING_DISCOUNT),
  }), {});

  const aov = totals.orders > 0 ? totals.revenue / totals.orders : 0;
  const discRate = totals.revenue > 0
    ? (((totals.pd + totals.sd) / totals.revenue) * 100).toFixed(1)
    : '0.0';

  const fmt = (v: number) => {
    if (v >= 1e9) return '₱' + (v / 1e9).toFixed(1) + 'B';
    if (v >= 1e6) return '₱' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '₱' + (v / 1e3).toFixed(0) + 'K';
    return '₱' + v.toFixed(0);
  };

  const fmtN = (v: number) => {
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
    return v.toLocaleString();
  };

  const s: Record<string, React.CSSProperties> = {
    page:    { minHeight: '100vh', background: '#0a0c10', color: '#dde1ec', fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 14 },
    topbar:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: '#0a0c10', flexWrap: 'wrap' as const, gap: 10 },
    tbl:     { display: 'flex', alignItems: 'center', gap: 10 },
    icon:    { width: 30, height: 30, borderRadius: 7, background: 'linear-gradient(135deg,#4b8ef0,#9b6ff0)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff' },
    title:   { fontSize: 15, fontWeight: 700 },
    badge:   { fontSize: 11, color: '#454e63', background: '#10131a', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 6, padding: '2px 9px' },
    tbr:     { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const },
    sel:     { background: '#10131a', border: '1px solid rgba(255,255,255,0.06)', color: '#dde1ec', fontFamily: 'inherit', fontSize: 12, padding: '5px 10px', borderRadius: 8, cursor: 'pointer' },
    drWrap:  { display: 'flex', alignItems: 'center', gap: 6, background: '#10131a', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: '4px 10px' },
    drLbl:   { fontSize: 10.5, color: '#454e63', whiteSpace: 'nowrap' as const },
    drInp:   { background: 'transparent', border: 'none', color: '#dde1ec', fontFamily: 'inherit', fontSize: 12, outline: 'none', cursor: 'pointer', width: 110 },
    logBtn:  { padding: '5px 12px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.06)', fontSize: 11.5, fontFamily: 'inherit', color: '#e85555', background: 'transparent', cursor: 'pointer' },
    content: { padding: '20px 24px' },
    kg:      { display: 'grid', gridTemplateColumns: 'repeat(5,minmax(0,1fr))', gap: 10, marginBottom: 16 },
    kpi:     { background: '#10131a', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '14px 16px' },
    kl:      { fontSize: 10, letterSpacing: '.4px', textTransform: 'uppercase' as const, color: '#454e63', marginBottom: 8 },
    kv:      { fontSize: 22, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: '#dde1ec', marginBottom: 4 },
    ks:      { fontSize: 10, color: '#454e63' },
    card:    { background: '#10131a', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 18, marginBottom: 12 },
    ct:      { fontSize: 13, fontWeight: 600, color: '#dde1ec', marginBottom: 4 },
    cs:      { fontSize: 10.5, color: '#454e63', marginBottom: 14 },
    tbl2:    { width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 },
    th:      { fontSize: 9.5, letterSpacing: '.4px', textTransform: 'uppercase' as const, color: '#454e63', fontWeight: 500, padding: '0 0 8px', borderBottom: '1px solid rgba(255,255,255,0.06)', textAlign: 'left' as const },
    td:      { padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#7e879e', verticalAlign: 'middle' as const },
    mono:    { fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#dde1ec' },
    expBtn:  { display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.06)', fontSize: 11, fontFamily: 'inherit', color: '#22c98a', background: 'transparent', cursor: 'pointer' },
  };

  const exportCSV = (data: any[], filename: string) => {
    if (!data.length) return;
    const headers = Object.keys(data[0]).join(',');
    const rows = data.map(r => Object.values(r).map(v => `"${v}"`).join(','));
    const blob = new Blob([[headers, ...rows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  };

  return (
    <div style={s.page}>
      {/* TOPBAR */}
      <header style={s.topbar}>
        <div style={s.tbl}>
          <div style={s.icon}>G</div>
          <div style={s.title}>Account Intelligence</div>
          <div style={s.badge}>{user?.isAdmin ? 'GDEC Admin' : user?.companyName}</div>
        </div>
        <div style={s.tbr}>
          {!user?.isAdmin && accounts.length > 1 && (
            <select style={s.sel} value={cAcc} onChange={e => setCAcc(e.target.value)}>
              <option value="all">All Accounts</option>
              {(accounts as string[]).map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
          {!user?.isAdmin && (
            <select style={s.sel} value={cPlat} onChange={e => setCPlat(e.target.value)}>
              <option value="all">All Platforms</option>
              {(platforms as string[]).map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
          <div style={s.drWrap}>
            <span style={s.drLbl}>From</span>
            <input type="date" style={s.drInp} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            <span style={s.drLbl}>—</span>
            <span style={s.drLbl}>To</span>
            <input type="date" style={s.drInp} value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
          <button style={s.logBtn} onClick={logout}>Sign out</button>
        </div>
      </header>

      <div style={s.content}>
        {/* KPI CARDS */}
        <div style={s.kg}>
          <div style={s.kpi}><div style={s.kl}>Total Revenue</div><div style={s.kv}>{fmt(totals.revenue || 0)}</div><div style={s.ks}>ORIGINAL_PRODUCT_PRICE</div></div>
          <div style={s.kpi}><div style={s.kl}>Total Orders</div><div style={s.kv}>{fmtN(totals.orders || 0)}</div><div style={s.ks}>Unique platform orders</div></div>
          <div style={s.kpi}><div style={s.kl}>Avg Order Value</div><div style={s.kv}>{fmt(aov)}</div><div style={s.ks}>Revenue ÷ orders</div></div>
          <div style={s.kpi}><div style={s.kl}>Total Discount</div><div style={s.kv}>{fmt((totals.pd || 0) + (totals.sd || 0))}</div><div style={s.ks}>{discRate}% of revenue</div></div>
          <div style={s.kpi}><div style={s.kl}>Ship. Discount</div><div style={s.kv}>{fmt(totals.ship || 0)}</div><div style={s.ks}>Platform absorbed</div></div>
        </div>

        {/* KPI TABLE */}
        <div style={s.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
            <div><div style={s.ct}>Account & Platform Breakdown</div><div style={s.cs}>Revenue, orders and AOV · active orders · 2023 onwards</div></div>
            <button style={s.expBtn} onClick={() => exportCSV(filteredKpis, 'kpi_breakdown.csv')}>⬇ Export CSV</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={s.tbl2}>
              <thead>
                <tr>
                  {!user?.isAdmin && <th style={s.th}>Account</th>}
                  <th style={s.th}>Platform</th>
                  <th style={s.th}>Orders</th>
                  <th style={s.th}>Items</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {filteredKpis.map((k: any, i: number) => (
                  <tr key={i}>
                    {!user?.isAdmin && <td style={s.td}>{k.ACCOUNT_NAME}</td>}
                    <td style={s.td}>{k.PLATFORM}</td>
                    <td style={{ ...s.td, ...s.mono }}>{fmtN(Number(k.ORDERS))}</td>
                    <td style={{ ...s.td, ...s.mono }}>{fmtN(Number(k.ITEMS))}</td>
                    <td style={{ ...s.td, ...s.mono, textAlign: 'right' }}>{fmt(Number(k.REVENUE))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* SHOP TABLE */}
        <div style={s.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
            <div><div style={s.ct}>Shop Performance</div><div style={s.cs}>Revenue, orders and AOV by SHOP_ID</div></div>
            <button style={s.expBtn} onClick={() => exportCSV(shops, 'shop_performance.csv')}>⬇ Export CSV</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={s.tbl2}>
              <thead>
                <tr>
                  <th style={s.th}>Shop</th>
                  <th style={s.th}>Platform</th>
                  <th style={s.th}>Shop ID</th>
                  <th style={s.th}>Orders</th>
                  <th style={s.th}>Items</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>AOV</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {shops.filter((s: any) =>
                  (cPlat === 'all' || s.PLATFORM === cPlat) &&
                  (cAcc  === 'all' || s.ACCOUNT_NAME === cAcc)
                ).map((s: any, i: number) => (
                  <tr key={i}>
                    <td style={s.td}>{s.SHOP_NAME}</td>
                    <td style={s.td}>{s.PLATFORM}</td>
                    <td style={{ ...s.td, fontSize: 10, fontFamily: 'monospace' }}>{s.SHOP_ID}</td>
                    <td style={{ ...s.td, ...s.mono }}>{fmtN(Number(s.ORDERS))}</td>
                    <td style={{ ...s.td, ...s.mono }}>{fmtN(Number(s.ITEMS))}</td>
                    <td style={{ ...s.td, ...s.mono, textAlign: 'right' }}>{fmt(Number(s.AOV))}</td>
                    <td style={{ ...s.td, ...s.mono, textAlign: 'right' }}>{fmt(Number(s.REVENUE))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* PRODUCT TABLE */}
        <div style={s.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
            <div><div style={s.ct}>Top Products</div><div style={s.cs}>Best selling items by revenue</div></div>
            <button style={s.expBtn} onClick={() => exportCSV(products, 'top_products.csv')}>⬇ Export CSV</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={s.tbl2}>
              <thead>
                <tr>
                  <th style={s.th}>Product</th>
                  <th style={s.th}>Platform</th>
                  <th style={s.th}>Orders</th>
                  <th style={s.th}>Units</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>ASP</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {products.filter((p: any) =>
                  (cPlat === 'all' || p.PLATFORM === cPlat) &&
                  (cAcc  === 'all' || p.ACCOUNT_NAME === cAcc)
                ).map((p: any, i: number) => (
                  <tr key={i}>
                    <td style={{ ...s.td, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.PRODUCT_NAME}</td>
                    <td style={s.td}>{p.PLATFORM}</td>
                    <td style={{ ...s.td, ...s.mono }}>{fmtN(Number(p.ORDERS))}</td>
                    <td style={{ ...s.td, ...s.mono }}>{fmtN(Number(p.UNITS))}</td>
                    <td style={{ ...s.td, ...s.mono, textAlign: 'right' }}>{fmt(Number(p.ASP))}</td>
                    <td style={{ ...s.td, ...s.mono, textAlign: 'right' }}>{fmt(Number(p.REVENUE))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}