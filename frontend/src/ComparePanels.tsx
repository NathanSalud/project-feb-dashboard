import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { getTimeSeries } from './api';
import posthog from './posthog';

// Side-by-side comparison panels (#2). Each panel has its OWN date range and KPI,
// so a user can set (e.g.) Panel A = Jan 2026 GMV next to Panel B = Jan 2026 Order
// Count, or the same KPI over two different ranges. Both panels share the current
// company/account/platform filters. Each shows a big aggregate total plus a trend
// chart bucketed by the panel's own granularity.

const TEAL = '#1a7a8a', BLUE2 = '#2a6080';
const WHITE = '#ffffff', BORDER = '#e2e8f0', TEXT1 = '#1a2332', TEXT3 = '#94a3b8';

type User = { isAdmin?: boolean; accountNames?: string[] } | null | undefined;

type KpiKey = 'gmv' | 'nmv' | 'units' | 'orders' | 'aov' | 'abs';
const KPIS: { key: KpiKey; label: string; kind: 'currency' | 'count' | 'ratio' }[] = [
  { key: 'gmv',    label: 'GMV',             kind: 'currency' },
  { key: 'nmv',    label: 'NMV',             kind: 'currency' },
  { key: 'units',  label: 'Units Sold',      kind: 'count' },
  { key: 'orders', label: 'Order Count',     kind: 'count' },
  { key: 'aov',    label: 'AOV',             kind: 'currency' },
  { key: 'abs',    label: 'Avg Basket Size', kind: 'ratio' },
];

const fmtCur = (v: number) => v >= 1e9 ? '₱' + (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? '₱' + (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? '₱' + (v / 1e3).toFixed(0) + 'K' : '₱' + Math.round(v).toLocaleString();
const fmtCnt = (v: number) => v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : Math.round(v).toLocaleString();
const fmtRat = (v: number) => (v || 0).toFixed(2);
const fmtFor = (kind: string) => kind === 'currency' ? fmtCur : kind === 'ratio' ? fmtRat : fmtCnt;

type Gran = 'day' | 'week' | 'month' | 'quarter' | 'year';
function groupKey(dateStr: string, g: Gran): string {
  const d = new Date(dateStr);
  if (g === 'day')     return dateStr.slice(0, 10);
  if (g === 'week')    { const s = new Date(d); s.setDate(d.getDate() - d.getDay()); return s.toISOString().slice(0, 10); }
  if (g === 'month')   return dateStr.slice(0, 7);
  if (g === 'quarter') { const q = Math.floor(d.getMonth() / 3) + 1; return `${d.getFullYear()}-Q${q}`; }
  if (g === 'year')    return String(d.getFullYear());
  return dateStr.slice(0, 7);
}
function bucketLabel(k: string, g: Gran): string {
  if (g === 'month') return new Date(k + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  if (g === 'year' || g === 'quarter') return k;
  return new Date(k).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

type Agg = { rev: number; revValid: number; orders: number; items: number; pd: number; sd: number };
const emptyAgg = (): Agg => ({ rev: 0, revValid: 0, orders: 0, items: 0, pd: 0, sd: 0 });
const addRow = (a: Agg, r: any) => {
  a.rev      += Number(r.REVENUE);
  a.revValid += Number(r.REVENUE_VALID);
  a.orders   += Number(r.ORDERS);
  a.items    += Number(r.ITEMS);
  a.pd       += Number(r.PLATFORM_DISCOUNT);
  a.sd       += Number(r.SELLER_DISCOUNT);
};
// Each KPI is computed from an aggregate, so AOV/ABS are ratios of the totals
// (never an average of per-bucket ratios) — the headline total and each chart bar
// stay consistent, and GMV mirrors the gross (incl. cancelled) dashboard definition.
const kpiValue = (kpi: KpiKey, a: Agg): number => {
  switch (kpi) {
    case 'gmv':    return a.rev;
    case 'nmv':    return a.revValid;  // valid-order GMV, before discounts (excl. cancelled only)
    case 'units':  return a.items;
    case 'orders': return a.orders;
    case 'aov':    return a.orders > 0 ? a.rev / a.orders : 0;
    case 'abs':    return a.orders > 0 ? a.items / a.orders : 0;
  }
};

const selStyle = { background: WHITE, border: `1px solid ${BORDER}`, color: TEXT1, fontFamily: 'inherit', fontSize: 11, padding: '4px 8px', borderRadius: 7, cursor: 'pointer' } as const;
const dateInputStyle = { background: 'transparent', border: 'none', color: TEXT1, fontFamily: 'inherit', fontSize: 11, outline: 'none', width: 104 } as const;

function ComparePanel({
  rows, loading, accent, defaultKpi, defaultFrom, defaultTo, latestDay,
}: {
  rows: any[]; loading: boolean; accent: string; defaultKpi: KpiKey;
  defaultFrom: string; defaultTo: string; latestDay: string;
}) {
  const [kpi, setKpi]   = useState<KpiKey>(defaultKpi);
  const [from, setFrom] = useState<string>(defaultFrom);
  const [to, setTo]     = useState<string>(defaultTo);
  const [gran, setGran] = useState<Gran>('month');

  const kcfg = KPIS.find(k => k.key === kpi)!;
  const f = fmtFor(kcfg.kind);

  // Filter the (already company/account/platform-scoped) rows to THIS panel's range.
  const inRange = rows.filter(r => {
    const raw = r.ORDER_DATE instanceof Date ? r.ORDER_DATE.toISOString().slice(0, 10) : String(r.ORDER_DATE).slice(0, 10);
    return raw >= from && raw <= to;
  });

  const total = (() => { const a = emptyAgg(); inRange.forEach(r => addRow(a, r)); return kpiValue(kpi, a); })();

  const chartData = (() => {
    const map: Record<string, Agg> = {};
    inRange.forEach(r => {
      const raw = r.ORDER_DATE instanceof Date ? r.ORDER_DATE.toISOString().slice(0, 10) : String(r.ORDER_DATE).slice(0, 10);
      const k = groupKey(raw, gran);
      if (!map[k]) map[k] = emptyAgg();
      addRow(map[k], r);
    });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, a]) => ({ label: bucketLabel(k, gran), value: kpiValue(kpi, a) }));
  })();

  const isLine = kcfg.kind !== 'count'; // currency/ratio as line, counts as bars

  return (
    <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
      {/* Controls */}
      <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6, alignItems: 'center', marginBottom: 12 }}>
        <select value={kpi} onChange={e => { setKpi(e.target.value as KpiKey); posthog.capture('dashboard_compare_kpi_changed', { kpi: e.target.value }); }} style={{ ...selStyle, fontWeight: 600, color: accent }}>
          {KPIS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
        </select>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 7, padding: '2px 8px' }}>
          <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} style={dateInputStyle} />
          <span style={{ color: TEXT3, fontSize: 10 }}>→</span>
          <input type="date" value={to} min={from} max={latestDay} onChange={e => setTo(e.target.value)} style={dateInputStyle} />
        </div>
        <select value={gran} onChange={e => setGran(e.target.value as Gran)} style={selStyle}>
          {(['day', 'week', 'month', 'quarter', 'year'] as Gran[]).map(g => <option key={g} value={g}>{g[0].toUpperCase() + g.slice(1)}</option>)}
        </select>
      </div>

      {/* Big total */}
      <div style={{ fontSize: 10, letterSpacing: '.5px', textTransform: 'uppercase' as const, color: TEXT3, marginBottom: 2 }}>{kcfg.label} · total</div>
      <div style={{ fontSize: 30, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: TEXT1, marginBottom: 2, lineHeight: 1.1 }}>
        {loading && !inRange.length ? '…' : f(total)}
      </div>
      <div style={{ fontSize: 10.5, color: TEXT3, marginBottom: 12 }}>{from} → {to}</div>

      {/* Trend */}
      <ResponsiveContainer width="100%" height={180}>
        {isLine ? (
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: TEXT3 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: TEXT3 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => f(v)} width={55} />
            <Tooltip contentStyle={{ backgroundColor: WHITE, border: `1px solid ${BORDER}`, borderRadius: 8, color: TEXT1, fontSize: 11 }} formatter={(v: any) => f(Number(v))} />
            <Line type="monotone" dataKey="value" name={kcfg.label} stroke={accent} strokeWidth={2} dot={false} />
          </LineChart>
        ) : (
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: TEXT3 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: TEXT3 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => f(v)} width={45} />
            <Tooltip contentStyle={{ backgroundColor: WHITE, border: `1px solid ${BORDER}`, borderRadius: 8, color: TEXT1, fontSize: 11 }} formatter={(v: any) => f(Number(v))} />
            <Bar dataKey="value" name={kcfg.label} fill={accent} radius={[3, 3, 0, 0]} opacity={0.85} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

export default function ComparePanels({
  user, cCompany, cAcc, cPlat, cBrand, cCategory,
}: {
  user: User; cCompany: string; cAcc: string; cPlat: string; cBrand: string; cCategory: string;
}) {
  // Fetch the full timeseries once (no date params) and slice per panel in-memory,
  // so changing either panel's range is instant and never refetches. Brand/category
  // are applied server-side (keyed below) so the panels match the rest of the
  // dashboard; company/account/platform are applied client-side.
  const { data: tsFull = [], isFetching } = useQuery({
    queryKey: ['compare-timeseries-full', cBrand, cCategory],
    queryFn: () => getTimeSeries(undefined, undefined, cBrand, cCategory).then(r => r.data),
    placeholderData: keepPreviousData,
    enabled: !!user,
  });

  const rows = (tsFull as any[]).filter(r =>
    (cCompany === 'all' || r.COMPANY_NAME === cCompany) &&
    (cPlat === 'all' || r.PLATFORM === cPlat) &&
    (cAcc === 'all' || r.ACCOUNT_NAME === cAcc) &&
    (user?.isAdmin || user?.accountNames?.includes(r.ACCOUNT_NAME))
  );

  // Latest day present → sensible default ranges (this year vs last year) without a
  // hardcoded date. Falls back to today when data hasn't loaded yet.
  const latestDay = rows.reduce((mx: string, r: any) => {
    const d = r.ORDER_DATE instanceof Date ? r.ORDER_DATE.toISOString().slice(0, 10) : String(r.ORDER_DATE).slice(0, 10);
    return d > mx ? d : mx;
  }, '') || new Date().toISOString().slice(0, 10);
  const year = Number(latestDay.slice(0, 4));

  return (
    <div>
      <div style={{ fontSize: 10.5, color: TEXT3, marginBottom: 12 }}>
        Set each panel's KPI and date range independently to compare side by side — e.g. the same metric across two periods, or two metrics over the same window. Both panels follow the account/platform filters above.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 12, marginBottom: 20 }}>
        <ComparePanel rows={rows} loading={isFetching} accent={TEAL}  defaultKpi="gmv"
          defaultFrom={`${year}-01-01`} defaultTo={latestDay} latestDay={latestDay} />
        <ComparePanel rows={rows} loading={isFetching} accent={BLUE2} defaultKpi="gmv"
          defaultFrom={`${year - 1}-01-01`} defaultTo={`${year - 1}-12-31`} latestDay={latestDay} />
      </div>
    </div>
  );
}
