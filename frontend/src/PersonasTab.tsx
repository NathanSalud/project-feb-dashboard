import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend, CartesianGrid,
} from 'recharts';
import { getPersonas } from './api';

// Persona time windows. Tiers are recomputed within the selected window server-
// side (deciles calibrated on that window's buyers); `key` is the API `period`.
const PERIODS = [
  { key: 'ytd',      label: 'YTD',         note: 'year-to-date' },
  { key: '6m',       label: 'Past 6 mo',   note: 'past 6 months' },
  { key: '12m',      label: 'Past 12 mo',  note: 'past 12 months' },
  { key: 'lifetime', label: 'Lifetime',    note: 'lifetime (2023–present)' },
] as const;

// Persona view: RFM/persona segmentation, per platform, tenant-scoped server-side.
// Rows: { COMPANY_NAME, PLATFORM, TIER, SHOPPERS, PCT_SHOPPERS, TIER_REVENUE,
//         PCT_REVENUE, AVG_ORDERS, AVG_AOV, AVG_PROMO_PCT }

const TEAL = '#1a7a8a', GOLD = '#f5a623', STEEL = '#7c93a6', BRONZE = '#b0703c';
const WHITE = '#ffffff', BORDER = '#e2e8f0', SOFT = '#eef4f5';
const TEXT1 = '#1a2332', TEXT2 = '#4a5568', TEXT3 = '#94a3b8';

const TIER_ORDER = ['Loyalist', 'Habitual', 'Deal Hunter', 'Window Buyer'] as const;
const TIER_COLOR: Record<string, string> = {
  'Loyalist': TEAL, 'Habitual': GOLD, 'Deal Hunter': STEEL, 'Window Buyer': BRONZE,
};

const num = (v: any) => Number(v) || 0;
const fInt = (v: number) => Math.round(v).toLocaleString();
const peso = (v: number) => '₱' + Math.round(v).toLocaleString();

const card: React.CSSProperties = {
  background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12,
  padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
};
const title: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: TEXT1 };
const note: React.CSSProperties = { fontSize: 10.5, color: TEXT3, marginTop: 2, marginBottom: 12 };

export default function PersonasTab({ platform, company = 'all', isAdmin }: { platform: string; company?: string; isAdmin: boolean }) {
  const [period, setPeriod] = useState<string>('lifetime');
  const periodNote = PERIODS.find(p => p.key === period)?.note ?? 'lifetime (2023–present)';

  const { data: raw = [], isFetching } = useQuery({
    queryKey: ['personas', period],
    queryFn: () => getPersonas(period).then(r => r.data),
  });

  // Timeframe selector — always visible so the window can be switched even while
  // loading or when a window has no qualifying segments.
  const periodBar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 10, color: TEXT3, letterSpacing: '.4px', textTransform: 'uppercase', marginRight: 2 }}>Timeframe</span>
      {PERIODS.map(p => (
        <button key={p.key} onClick={() => setPeriod(p.key)}
          style={{ padding: '4px 10px', borderRadius: 7, border: `1px solid ${period === p.key ? TEAL : BORDER}`, fontSize: 11, fontFamily: 'inherit', cursor: 'pointer', background: period === p.key ? 'rgba(26,122,138,0.1)' : WHITE, color: period === p.key ? TEAL : TEXT2 }}>
          {p.label}
        </button>
      ))}
    </div>
  );

  // Persona rows are at (company, platform, tier) grain. Narrow by the admin's
  // Company and Platform filters; there is no account-level persona grain, so the
  // Account selector does not further filter this view.
  const rows = (raw as any[]).filter(r =>
    (company === 'all' || r.COMPANY_NAME === company) &&
    (platform === 'all' || r.PLATFORM === platform)
  );

  // Rows are per (company, platform, tier). When multiple platforms are in view,
  // sum counts/revenue and take shopper-weighted averages.
  const byTier = TIER_ORDER.map(tier => {
    const rs = rows.filter(r => r.TIER === tier);
    const shoppers = rs.reduce((a, r) => a + num(r.SHOPPERS), 0);
    const revenue = rs.reduce((a, r) => a + num(r.TIER_REVENUE), 0);
    const wOrders = rs.reduce((a, r) => a + num(r.AVG_ORDERS) * num(r.SHOPPERS), 0);
    const wAov = rs.reduce((a, r) => a + num(r.AVG_AOV) * num(r.SHOPPERS), 0);
    const wPromo = rs.reduce((a, r) => a + num(r.AVG_DISCOUNT_PCT) * num(r.SHOPPERS), 0);
    return {
      tier, shoppers, revenue,
      avgOrders: shoppers ? wOrders / shoppers : 0,
      avgAov: shoppers ? wAov / shoppers : 0,
      promo: shoppers ? wPromo / shoppers : 0,
    };
  });
  const totShoppers = byTier.reduce((a, t) => a + t.shoppers, 0);
  const totRevenue = byTier.reduce((a, t) => a + t.revenue, 0);
  const tiers = byTier.map(t => ({
    ...t,
    pctShoppers: totShoppers ? (t.shoppers / totShoppers) * 100 : 0,
    pctRevenue: totRevenue ? (t.revenue / totRevenue) * 100 : 0,
  }));

  if (isFetching) {
    return (
      <div style={{ display: 'grid', gap: 12, marginBottom: 20 }}>
        {periodBar}
        <div style={card}><div style={{ color: TEXT3, fontSize: 12, padding: 24 }}>Loading personas…</div></div>
      </div>
    );
  }
  if (!totShoppers) {
    return (
      <div style={{ display: 'grid', gap: 12, marginBottom: 20 }}>
        {periodBar}
        <div style={card}>
          <div style={{ color: TEXT2, fontSize: 12.5, padding: 20, lineHeight: 1.6 }}>
            No persona data for this selection ({periodNote}). Segments under 500 buyers are omitted, so a small
            account, platform, or short window may not appear — try a wider timeframe or switching the platform
            filter to <b>All Platforms</b>.
          </div>
        </div>
      </div>
    );
  }

  const top = tiers[0];
  const bottomTwoBuyers = (tiers[2]?.pctShoppers ?? 0) + (tiers[3]?.pctShoppers ?? 0);
  const bottomTwoRev = (tiers[2]?.pctRevenue ?? 0) + (tiers[3]?.pctRevenue ?? 0);

  const pieData = tiers.map(t => ({ name: t.tier, value: +t.pctShoppers.toFixed(1) }));
  const paretoData = tiers.map(t => ({
    name: t.tier, Buyers: +t.pctShoppers.toFixed(1), GMV: +t.pctRevenue.toFixed(1),
  }));
  const promoData = tiers.map(t => ({ name: t.tier, Promo: +t.promo.toFixed(1) }));

  return (
    <div style={{ display: 'grid', gap: 16, marginBottom: 20 }}>
      {periodBar}
      {isAdmin && (
        <div style={{ fontSize: 10.5, color: TEXT3, marginTop: -6 }}>
          {company === 'all'
            ? `Admin view — persona tiers aggregated across all companies · ${periodNote}. Pick a Company above for a single-brand read.`
            : `Admin view — personas for ${company} · ${periodNote}.`}
        </div>
      )}

      {/* Row 1: donut + pareto */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.35fr', gap: 16 }}>
        <div style={card}>
          <div style={title}>Persona mix</div>
          <div style={note}>Share of buyers in each value tier</div>
          <ResponsiveContainer width="100%" height={230}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                   innerRadius={58} outerRadius={90} paddingAngle={2}>
                {pieData.map(d => <Cell key={d.name} fill={TIER_COLOR[d.name]} />)}
              </Pie>
              <Tooltip formatter={(v: any) => [`${v}% of buyers`, '']} />
              <Legend iconType="circle" formatter={(v) => <span style={{ fontSize: 11, color: TEXT2 }}>{v}</span>} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div style={card}>
          <div style={title}>Where the value sits</div>
          <div style={note}>Share of buyers vs share of GMV, per tier</div>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={paretoData} margin={{ top: 6, right: 10, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={BORDER} vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10.5, fill: TEXT2 }} />
              <YAxis unit="%" tick={{ fontSize: 10, fill: TEXT3 }} />
              <Tooltip formatter={(v: any, k: any) => [`${v}%`, k]} />
              <Legend iconType="circle" formatter={(v) => <span style={{ fontSize: 11, color: TEXT2 }}>{v}</span>} />
              <Bar dataKey="Buyers" fill={STEEL} radius={[3, 3, 0, 0]} opacity={0.55} />
              <Bar dataKey="GMV" fill={TEAL} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div style={{ background: SOFT, borderLeft: `3px solid ${TEAL}`, borderRadius: 8, padding: '9px 12px', fontSize: 12, color: TEXT2, marginTop: 8 }}>
            <b style={{ color: TEAL }}>The gap is the story.</b> {top.tier}s are {top.pctShoppers.toFixed(0)}% of
            buyers but {top.pctRevenue.toFixed(0)}% of GMV; the bottom two tiers are {bottomTwoBuyers.toFixed(0)}%
            of buyers and {bottomTwoRev.toFixed(0)}% of GMV.
          </div>
        </div>
      </div>

      {/* Row 2: scorecard + promo */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={card}>
          <div style={title}>Per-persona scorecard</div>
          <div style={note}>Who each tier is, and how they buy</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr>
              {['Persona', 'Buyers', '% Buyers', '% GMV', 'Avg orders', 'Avg AOV'].map((h, i) => (
                <th key={h} style={{ fontSize: 9.5, color: TEXT3, fontWeight: 500, padding: '0 6px 9px', borderBottom: `1px solid ${BORDER}`, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {tiers.map(t => (
                <tr key={t.tier}>
                  <td style={{ padding: '9px 6px', borderBottom: `1px solid ${BORDER}`, color: TEXT1, fontWeight: 600 }}>
                    <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 3, background: TIER_COLOR[t.tier], marginRight: 8 }} />{t.tier}
                  </td>
                  <td style={{ padding: '9px 6px', borderBottom: `1px solid ${BORDER}`, color: TEXT2, textAlign: 'right' }}>{fInt(t.shoppers)}</td>
                  <td style={{ padding: '9px 6px', borderBottom: `1px solid ${BORDER}`, color: TEXT2, textAlign: 'right' }}>{t.pctShoppers.toFixed(1)}%</td>
                  <td style={{ padding: '9px 6px', borderBottom: `1px solid ${BORDER}`, color: TEXT2, textAlign: 'right' }}>{t.pctRevenue.toFixed(1)}%</td>
                  <td style={{ padding: '9px 6px', borderBottom: `1px solid ${BORDER}`, color: TEXT2, textAlign: 'right' }}>{t.avgOrders.toFixed(1)}</td>
                  <td style={{ padding: '9px 6px', borderBottom: `1px solid ${BORDER}`, color: TEXT2, textAlign: 'right' }}>{peso(t.avgAov)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={card}>
          <div style={title}>Discount-reliance lens <span style={{ fontWeight: 500, color: TEXT3, fontSize: 10.5 }}>· separate axis</span></div>
          <div style={note}>Share of each tier's GMV from discounted orders</div>
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={promoData} layout="vertical" margin={{ top: 2, right: 26, left: 30, bottom: 0 }}>
              <XAxis type="number" unit="%" tick={{ fontSize: 10, fill: TEXT3 }} />
              <YAxis type="category" dataKey="name" width={78} tick={{ fontSize: 10.5, fill: TEXT2 }} />
              <Tooltip formatter={(v: any) => [`${v}%`, 'Discounted GMV']} />
              <Bar dataKey="Promo" radius={[0, 4, 4, 0]}>
                {promoData.map(d => <Cell key={d.name} fill={TIER_COLOR[d.name]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div style={{ background: '#fff8ec', borderLeft: `3px solid ${GOLD}`, borderRadius: 8, padding: '9px 12px', fontSize: 12, color: TEXT2, marginTop: 8 }}>
            <b style={{ color: '#b07e00' }}>Not the same as value.</b> Discount reliance is its own axis — a true
            bargain-hunter is <b>low-frequency + high-discount</b>, which may or may not be the lowest-value tier
            depending on the category.
          </div>
        </div>
      </div>

      <div style={{ fontSize: 10, color: TEXT3, textAlign: 'center' }}>
        Behavioral personas from order history · {periodNote} · tiers recomputed per timeframe · weights pending metric-owner sign-off.
      </div>
    </div>
  );
}
