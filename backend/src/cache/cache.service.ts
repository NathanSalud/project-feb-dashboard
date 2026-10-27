import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SnowflakeService } from '../snowflake/snowflake.service';
import * as cron from 'node-cron';

/**
 * The single definition of "valid revenue" order-item statuses used by every
 * FACT_PLATFORM_ORDER_ITEMS aggregation (KPIs, trends, shops, products, geo,
 * discounts). Kept in one place so the 8 queries can never drift apart.
 * NOTE: 'Ready to Ship' is intentionally included — this reflects the current
 * agreed revenue definition. Changing this list changes reported revenue.
 */
const VALID_REVENUE_STATUSES = ['Completed', 'Shipped', 'Delivered', 'Ready to Ship'] as const;

// Pre-rendered SQL fragment, e.g. "'Completed','Shipped','Delivered','Ready to Ship'"
const VALID_REVENUE_STATUS_SQL = VALID_REVENUE_STATUSES.map(s => `'${s}'`).join(',');

// GMV status scope (decision, Oct 2026): GMV = gross merchandise value of orders
// PLACED, so it INCLUDES cancelled orders. NMV, Orders, Items, discounts and the
// ASP/AOV bases stay on VALID statuses only (net of cancellations). Every revenue
// query therefore widens its WHERE to GMV_STATUSES and splits each measure with a
// per-row "valid?" guard: SUM(ORIGINAL_PRODUCT_PRICE) over the whole result set is
// gross GMV; everything else is wrapped in IFF(valid). Returns/failed stay out of
// both — "include cancelled" is specifically about cancellations.
const CANCELLED_STATUSES = ['Cancelled', 'Cancel requested'] as const;
const GMV_STATUSES = [...VALID_REVENUE_STATUSES, ...CANCELLED_STATUSES];
const GMV_STATUS_SQL = GMV_STATUSES.map(s => `'${s}'`).join(',');
// Reusable per-row "is this a valid (non-cancelled) revenue row?" SQL predicate,
// for the IFF() guards that keep NMV/orders/items/discounts on valid rows only.
const IS_VALID_SQL = `f.ITEM_STATUS IN (${VALID_REVENUE_STATUS_SQL})`;

// Onboarding floor: never show a marketplace account's orders from before it was
// onboarded (DIM_MARKETPLACE_ACCOUNTS.ONBOARD_DATE) — that pre-onboarding data is
// spurious and, e.g., fragments the trend lines. Appended to every FACT↔DIM join
// below (f = fact, a = accounts dim). Accounts with a NULL onboard date are left
// unfiltered so they behave exactly as before.
const ONBOARD_FLOOR_SQL = '(a.ONBOARD_DATE IS NULL OR f.ORDER_DATE >= a.ONBOARD_DATE)';

const FACT_SQL     = 'GDEC_ANALYTICS.DATA_QUALITY_RECOVERY.FACT_PLATFORM_ORDER_ITEMS_ENRICHED';
const ACCOUNTS_SQL = 'GDEC_DATAMART.GOLD_SCHEMA.DIM_MARKETPLACE_ACCOUNTS';

// ── Brand / Category mapping (DIM_PRODUCTS) ──────────────────────────
// Brand and product category live at SKU grain in DIM_PRODUCTS, joined to the fact
// on (PLATFORM, SHOP_ID, PRODUCT_SKU = SELLER_SKU) — a key verified unique, so this
// LEFT JOIN is 1:1 and never fans out / inflates metrics. ~94% of order-item rows
// match; the rest have no brand/category and drop out only when a specific
// brand/category is selected. The join is added ONLY when a brand or category filter
// is active, so the default dashboard paths keep using their lean, cached queries
// with no dim join and no extra memory.
const PRODUCT_DIM_JOIN = `LEFT JOIN GDEC_DATAMART.GOLD_SCHEMA.DIM_PRODUCTS p ON p.PLATFORM = f.PLATFORM AND p.SHOP_ID = f.SHOP_ID AND p.PRODUCT_SKU = f.SELLER_SKU`;

// ── Buyer-persona scoring config ─────────────────────────────────────
// Pat's playbook formula, percentile-calibrated: each input is scored 1-10 by
// decile WITHIN the tenant's own (company, platform), then combined and banded.
//   Persona Score = 40%*LTV + 25%*Frequency + 20%*AOV + 15%*Repeat(=recency)
const PERSONA_WEIGHTS = { ltv: 0.40, freq: 0.25, aov: 0.20, rr: 0.15 };
// Tier cut-offs on the 1-10 weighted score (metric-owner adjustable).
const PERSONA_TIERS = { platinum: 8, gold: 5, silver: 2 };
// Only score a (company, platform) with at least this many real buyers — below
// this, deciles are meaningless. Smaller segments are omitted from the dataset.
const PERSONA_MIN_SHOPPERS = 500;
// Value metric = gross ORIGINAL_PRODUCT_PRICE, matching the dashboard REVENUE KPI
// so persona revenue reconciles. Swap to net by subtracting the discounts.
const PERSONA_VALUE_EXPR = 'f.ORIGINAL_PRODUCT_PRICE';
// Buyer key on FACT_PLATFORM_ORDER_ITEMS (verified via DESCRIBE TABLE).
const PERSONA_SHOPPER_COL = 'f.BUYER_ID';
// The fact has no campaign flag, so promo-sensitivity uses DISCOUNT RELIANCE:
// the share of a tier's gross revenue that carried any platform/seller discount —
// a direct, fully-sourced deal-seeking signal.
const PERSONA_DISCOUNT_EXPR = '(COALESCE(f.PLATFORM_DISCOUNT, 0) + COALESCE(f.SELLER_DISCOUNT, 0))';

// Persona time windows. Tiers are recomputed WITHIN each window — the NTILE
// deciles are calibrated on that window's own buyer population — and recency is
// measured to the window end (today, for these trailing windows), so all four
// RFM inputs share the same window. Keys are the API `period` values; each value
// is the SQL date-floor predicate applied to the fact. All stay within the 2023+
// scope. Personas are precomputed per period on refresh and cached separately.
const PERSONA_PERIODS: Record<string, string> = {
  lifetime: `f.ORDER_DATE >= '2023-01-01'`,
  ytd:      `f.ORDER_DATE >= DATE_TRUNC('year', CURRENT_DATE)`,
  '12m':    `f.ORDER_DATE >= DATEADD('month', -12, CURRENT_DATE)`,
  '6m':     `f.ORDER_DATE >= DATEADD('month', -6, CURRENT_DATE)`,
};
const PERSONA_DEFAULT_PERIOD = 'lifetime';

// ── Order-quality status buckets ─────────────────────────────────────
// Cancellation/return metrics look at ALL statuses (unlike the revenue
// queries, which keep only VALID_REVENUE_STATUSES). Kept as SQL fragments.
const CANCELLED_STATUS_SQL = CANCELLED_STATUSES.map(s => `'${s}'`).join(',');
const RETURNED_STATUS_SQL  = `'Returned','Return requested','Return in progress'`;

// Retention (repeat purchase) is a buyer-level metric that cannot be summed
// across segments, so it is precomputed per (company, platform) plus rollups
// over a fixed trailing window. Not tied to the dashboard date picker.
const RETENTION_FLOOR_SQL = `f.ORDER_DATE >= DATEADD('month', -12, CURRENT_DATE)`;
const RETENTION_ALL = '__ALL__'; // sentinel for the company/platform rollup rows

// Sales-by-province (geo) time windows. Same precompute-per-window trick as
// personas: each window is a small province-level aggregate (NOT daily grain),
// so caching a handful of them is cheap — this is what makes date-scoped geo
// affordable where a fully date-flexible version was not. Keys are the API
// `period` values; `overall` reproduces the previous all-time behavior.
const GEO_PERIODS: Record<string, string> = {
  overall: `f.ORDER_DATE >= '2023-01-01'`,
  ytd:     `f.ORDER_DATE >= DATE_TRUNC('year', CURRENT_DATE)`,
  '12m':   `f.ORDER_DATE >= DATEADD('month', -12, CURRENT_DATE)`,
  '24m':   `f.ORDER_DATE >= DATEADD('month', -24, CURRENT_DATE)`,
};
const GEO_DEFAULT_PERIOD = 'overall';

@Injectable()
export class CacheService implements OnModuleInit {
  private readonly logger = new Logger(CacheService.name);
  private cache: Map<string, any> = new Map();
  private lastRefreshed: Date | null = null;

  // ── Lazy per-tenant caching for timeseries/discounts ──────────────
  // These two datasets are NO LONGER preloaded for all tenants (that was the
  // OOM source). They are fetched per-tenant on demand and cached with bounds.
  private readonly TENANT_CACHE_MODE = process.env.TENANT_CACHE ?? 'lazy'; // 'lazy' | 'ondemand'
  private readonly MAX_TENANTS = Number(process.env.TENANT_CACHE_MAX ?? 20); // per dataset (count bound)
  private readonly TTL_MS = Number(process.env.TENANT_CACHE_TTL_MS ?? 3 * 60 * 60 * 1000); // 3h (time bound)

  private timeseriesByCompany = new Map<string, { data: any[]; expiresAt: number }>();
  private discountsByCompany = new Map<string, { data: any[]; expiresAt: number }>();
  private timeseriesInflight = new Map<string, Promise<any[]>>();
  private discountsInflight = new Map<string, Promise<any[]>>();
  // Top Products is date-aware and merged across platforms/accounts (#6), so it is
  // computed per (company, date range, platform, account) on demand and cached with
  // the same TTL/LRU bounds as the other lazy datasets. Keyed by the full param set.
  private productsRankedCache = new Map<string, { data: any[]; expiresAt: number }>();
  private productsRankedInflight = new Map<string, Promise<any[]>>();
  // Brand/category-filtered variants of the lazy datasets, cached separately per
  // (company, brand, category) and only populated when a brand/category filter is
  // active — so the default (unfiltered) paths above are untouched.
  private timeseriesBCByCompany = new Map<string, { data: any[]; expiresAt: number }>();
  private timeseriesBCInflight = new Map<string, Promise<any[]>>();
  private discountsBCByCompany = new Map<string, { data: any[]; expiresAt: number }>();
  private discountsBCInflight = new Map<string, Promise<any[]>>();
  private cancellationsBCByCompany = new Map<string, { data: any[]; expiresAt: number }>();
  private cancellationsBCInflight = new Map<string, Promise<any[]>>();
  // Brand/category-filtered geo, retention and personas (on demand).
  private geoBCCache = new Map<string, { data: any[]; expiresAt: number }>();
  private geoBCInflight = new Map<string, Promise<any[]>>();
  private retentionBCCache = new Map<string, { data: any[]; expiresAt: number }>();
  private retentionBCInflight = new Map<string, Promise<any[]>>();
  private personasBCCache = new Map<string, { data: any[]; expiresAt: number }>();
  private personasBCInflight = new Map<string, Promise<any[]>>();
  // New-vs-existing buyers: date-range dependent, computed on demand and cached per
  // (company, from, to, platform, account, brand, category).
  private newVsExistingCache = new Map<string, { data: any[]; expiresAt: number }>();
  private newVsExistingInflight = new Map<string, Promise<any[]>>();
  private adminMutex: Promise<unknown> = Promise.resolve(); // serializes heavy admin loads

  // How many per-window warm queries (personas, geo) may hit Snowflake at once.
  // The four windows of each dataset are independent, so warming them in a small
  // pool turns startup from sum-of-N into ~sum/limit — the main startup speed-up —
  // while the cap avoids firing all four heavy decile queries at once (the spike
  // the original serial loops guarded against). Env-overridable if the warehouse
  // wants it tighter or looser.
  private readonly WARM_CONCURRENCY = Math.max(1, Number(process.env.WARM_CONCURRENCY ?? 2));

  constructor(private snowflake: SnowflakeService) {}

  // Bounded-concurrency map: runs `worker` over `items`, at most `limit` in
  // flight at a time. Single-threaded JS means the shift() below never races.
  private async mapPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
    const queue = [...items];
    const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
      while (queue.length) {
        const item = queue.shift() as T;
        await worker(item);
      }
    });
    await Promise.all(runners);
  }

  async onModuleInit() {
    this.logger.log('Populating cache on startup...');
    await this.refreshAll();

    // Schedule nightly refresh at midnight PHT (UTC+8) = 16:00 UTC
    cron.schedule('0 16 * * *', async () => {
      this.logger.log('Running scheduled midnight PHT cache refresh...');
      await this.refreshAll();
      this.clearLazyCaches(); // drop per-tenant slices so they reload fresh
    });
  }

  private async refreshAll() {
    try {
      // NOTE: timeseries & discounts are intentionally NOT preloaded here —
      // they are fetched per-tenant on demand (see getTimeSeries/getDiscounts).
      await Promise.all([
        this.refreshKpis(),
        this.refreshShops(),
        this.refreshProducts(),
        this.refreshAccounts(),
        this.refreshGeo(),
        this.refreshDoi(),
        this.refreshPersonas(),
        this.refreshCancellations(),
        this.refreshRetention(),
        this.refreshProductDims(),
      ]);
      this.lastRefreshed = new Date();
      this.logger.log(`Cache refreshed successfully at ${this.lastRefreshed.toISOString()}`);
    } catch (err) {
      this.logger.error('Cache refresh failed', (err as Error).message);
    }
  }

  private async refreshKpis() {
    const data = await this.snowflake.query(`
      SELECT
        a.COMPANY_NAME,
        a.ACCOUNT_NAME,
        a.PLATFORM,
        COUNT(DISTINCT f.PLATFORM_ORDER_ID)             AS ORDERS,
        COUNT(f.ORDER_ITEM_SK)                          AS ITEMS,
        ROUND(SUM(f.ORIGINAL_PRODUCT_PRICE), 2)         AS REVENUE,
        ROUND(SUM(f.PLATFORM_DISCOUNT), 2)              AS PLATFORM_DISCOUNT,
        ROUND(SUM(f.SELLER_DISCOUNT), 2)                AS SELLER_DISCOUNT,
        ROUND(SUM(f.PLATFORM_SHIPPING_FEE_DISCOUNT), 2) AS SHIPPING_DISCOUNT
      FROM GDEC_ANALYTICS.DATA_QUALITY_RECOVERY.FACT_PLATFORM_ORDER_ITEMS_ENRICHED f
      INNER JOIN GDEC_DATAMART.GOLD_SCHEMA.DIM_MARKETPLACE_ACCOUNTS a ON f.SHOP_ID = a.SHOP_ID AND ${ONBOARD_FLOOR_SQL}
      WHERE f.ITEM_STATUS IN (${VALID_REVENUE_STATUS_SQL})
      AND f.ORDER_DATE >= '2023-01-01'
      AND a.IS_ACTIVE = TRUE
      AND a.ACCOUNT_NAME != 's'
      GROUP BY a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM
      ORDER BY a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM
    `);
    this.cache.set('kpis', data);
    this.logger.log(`KPIs cached — ${data.length} rows`);
  }

  // Buyer personas: one row per (company, platform, tier). Scores every eligible
  // shopper on the RFM/Pat formula (percentile-calibrated per company+platform),
  // then rolls up to tier level so the cached payload stays tiny (~hundreds of
  // rows). Lifetime metrics — intentionally NOT date-filtered. Refinements:
  // sentinel-ID filter, min-population gate, and the shared revenue-status guard.
  // Builds the persona RFM query for a given date-floor predicate (see
  // PERSONA_PERIODS). Tiers/deciles are recomputed on whatever window the floor
  // selects; recency (days_since_last) is measured to CURRENT_DATE = window end.
  private personaQuery(dateFloor: string): string {
    const W = PERSONA_WEIGHTS;
    const value = PERSONA_VALUE_EXPR;
    const shopper = PERSONA_SHOPPER_COL;
    const score = `(${W.ltv}*ltv_score + ${W.freq}*freq_score + ${W.aov}*aov_score + ${W.rr}*rr_score)`;
    return `
      WITH shopper AS (
        SELECT
          a.COMPANY_NAME,
          a.PLATFORM,
          ${shopper}                                                      AS SHOPPER,
          SUM(${value})                                                   AS value,
          COUNT(DISTINCT f.PLATFORM_ORDER_ID)                             AS orders,
          SUM(${value}) / NULLIF(COUNT(DISTINCT f.PLATFORM_ORDER_ID), 0)  AS aov,
          DATEDIFF('day', MAX(f.ORDER_DATE), CURRENT_DATE)                AS days_since_last,
          SUM(IFF(${PERSONA_DISCOUNT_EXPR} > 0, ${value}, 0))
            / NULLIF(SUM(${value}), 0)                                    AS discount_share
        FROM GDEC_ANALYTICS.DATA_QUALITY_RECOVERY.FACT_PLATFORM_ORDER_ITEMS_ENRICHED f
        INNER JOIN GDEC_DATAMART.GOLD_SCHEMA.DIM_MARKETPLACE_ACCOUNTS a ON f.SHOP_ID = a.SHOP_ID AND ${ONBOARD_FLOOR_SQL}
        WHERE f.ITEM_STATUS IN (${VALID_REVENUE_STATUS_SQL})
          AND ${dateFloor}
          AND a.IS_ACTIVE = TRUE
          AND a.ACCOUNT_NAME != 's'
          AND ${shopper} IS NOT NULL
          AND UPPER(TRIM(${shopper})) NOT IN ('0', 'N/A', 'NULL', '-1', '')
        GROUP BY a.COMPANY_NAME, a.PLATFORM, ${shopper}
      ),
      scored AS (
        SELECT s.*,
          COUNT(*)  OVER (PARTITION BY COMPANY_NAME, PLATFORM)                              AS seg_shoppers,
          NTILE(10) OVER (PARTITION BY COMPANY_NAME, PLATFORM ORDER BY value  ASC)          AS ltv_score,
          -- Frequency (order count) is highly tie-prone: large blocks of buyers share the
          -- same value (1 order, 2 orders, ...), and NTILE splits a tied block across
          -- deciles by row position, so identical buyers could score differently. Use a
          -- VALUE-based rank instead: PERCENT_RANK gives every buyer with the same order
          -- count the same percentile, mapped to a 1-10 bucket (bottom tie group -> 1,
          -- top -> 10). ltv/aov/recency stay on NTILE — they're near-continuous, so ties
          -- at a boundary are rare and equal-headcount deciles are fine there.
          LEAST(10, FLOOR(PERCENT_RANK() OVER (PARTITION BY COMPANY_NAME, PLATFORM ORDER BY orders ASC) * 10) + 1) AS freq_score,
          NTILE(10) OVER (PARTITION BY COMPANY_NAME, PLATFORM ORDER BY aov    ASC)          AS aov_score,
          NTILE(10) OVER (PARTITION BY COMPANY_NAME, PLATFORM ORDER BY days_since_last DESC) AS rr_score
        FROM shopper s
      ),
      persona AS (
        SELECT *,
          CASE
            WHEN ${score} >= ${PERSONA_TIERS.platinum} THEN 'Loyalist'
            WHEN ${score} >= ${PERSONA_TIERS.gold}     THEN 'Habitual'
            WHEN ${score} >= ${PERSONA_TIERS.silver}   THEN 'Deal Hunter'
            ELSE 'Window Buyer'
          END AS TIER
        FROM scored
        WHERE seg_shoppers >= ${PERSONA_MIN_SHOPPERS}
      )
      SELECT
        COMPANY_NAME,
        PLATFORM,
        TIER,
        COUNT(*)                                                                                AS SHOPPERS,
        ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (PARTITION BY COMPANY_NAME, PLATFORM), 1)    AS PCT_SHOPPERS,
        ROUND(SUM(value))                                                                       AS TIER_REVENUE,
        ROUND(100.0 * SUM(value) / NULLIF(SUM(SUM(value)) OVER (PARTITION BY COMPANY_NAME, PLATFORM), 0), 1) AS PCT_REVENUE,
        ROUND(AVG(orders), 1)                                                                    AS AVG_ORDERS,
        ROUND(AVG(aov))                                                                          AS AVG_AOV,
        ROUND(100.0 * AVG(discount_share), 1)                                                    AS AVG_DISCOUNT_PCT
      FROM persona
      GROUP BY COMPANY_NAME, PLATFORM, TIER
      ORDER BY COMPANY_NAME, PLATFORM, TIER
    `;
  }

  // Precompute personas for every time window and cache each under
  // `personas:<period>`. Windows are independent and warm in a bounded pool
  // (WARM_CONCURRENCY) — faster startup without spiking the warehouse with all
  // four heavy decile queries at once.
  private async refreshPersonas() {
    await this.mapPool(Object.entries(PERSONA_PERIODS), this.WARM_CONCURRENCY, async ([period, floor]) => {
      try {
        const data = await this.snowflake.query(this.personaQuery(floor));
        this.cache.set(`personas:${period}`, data);
        this.logger.log(`Personas[${period}] cached — ${data.length} rows`);
      } catch (err) {
        // Fail-soft per window: a persona-query error must never break the rest
        // of the nightly refresh. Serve an empty set; the frontend shows its
        // "no data" state for that window.
        this.cache.set(`personas:${period}`, []);
        this.logger.warn(`Personas[${period}] refresh skipped: ${(err as Error).message}`);
      }
    });
  }

  // Cancellation / return counts by day, per (company, account, platform).
  // Unlike the revenue queries this reads ALL statuses (no valid-revenue
  // filter) so cancellations are visible; the onboarding floor + active/'s'
  // guards still apply for consistency. Date-filterable in the getter.
  private async refreshCancellations() {
    const data = await this.snowflake.query(`
      SELECT
        a.COMPANY_NAME,
        a.ACCOUNT_NAME,
        a.PLATFORM,
        DATE_TRUNC('DAY', f.ORDER_DATE)                                        AS ORDER_DATE,
        COUNT(f.ORDER_ITEM_SK)                                                 AS ITEMS,
        SUM(IFF(f.ITEM_STATUS IN (${CANCELLED_STATUS_SQL}), 1, 0))             AS CANCELLED,
        SUM(IFF(f.ITEM_STATUS IN (${RETURNED_STATUS_SQL}), 1, 0))              AS RETURNED
      FROM GDEC_ANALYTICS.DATA_QUALITY_RECOVERY.FACT_PLATFORM_ORDER_ITEMS_ENRICHED f
      INNER JOIN GDEC_DATAMART.GOLD_SCHEMA.DIM_MARKETPLACE_ACCOUNTS a ON f.SHOP_ID = a.SHOP_ID AND ${ONBOARD_FLOOR_SQL}
      WHERE f.ORDER_DATE >= '2023-01-01'
      AND a.IS_ACTIVE = TRUE
      AND a.ACCOUNT_NAME != 's'
      GROUP BY a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM, DATE_TRUNC('DAY', f.ORDER_DATE)
      ORDER BY a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM, ORDER_DATE
    `);
    this.cache.set('cancellations', data);
    this.logger.log(`Cancellations cached — ${data.length} rows`);
  }

  // Brand/category-aware cancellations (for the Cancellation Rate KPI), same shape
  // as the eager cancellations query + the DIM_PRODUCTS join and brand/category
  // WHERE. On-demand only; cached per (company, brand, category).
  private fetchCancellationsEnriched(company: string | null, brand?: string, category?: string): Promise<any[]> {
    const bc = this.brandCatWhere(brand, category);
    const binds: any[] = [];
    const compSql = company ? ' AND a.COMPANY_NAME = ?' : '';
    if (company) binds.push(company);
    binds.push(...bc.binds);
    return this.snowflake.query(`
      SELECT
        a.COMPANY_NAME,
        a.ACCOUNT_NAME,
        a.PLATFORM,
        DATE_TRUNC('DAY', f.ORDER_DATE)                                        AS ORDER_DATE,
        COUNT(f.ORDER_ITEM_SK)                                                 AS ITEMS,
        SUM(IFF(f.ITEM_STATUS IN (${CANCELLED_STATUS_SQL}), 1, 0))             AS CANCELLED,
        SUM(IFF(f.ITEM_STATUS IN (${RETURNED_STATUS_SQL}), 1, 0))              AS RETURNED
      FROM ${FACT_SQL} f
      INNER JOIN ${ACCOUNTS_SQL} a ON f.SHOP_ID = a.SHOP_ID AND ${ONBOARD_FLOOR_SQL}
      ${PRODUCT_DIM_JOIN}
      WHERE f.ORDER_DATE >= '2023-01-01'
      AND a.IS_ACTIVE = TRUE
      AND a.ACCOUNT_NAME != 's'${compSql}${bc.sql}
      GROUP BY a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM, DATE_TRUNC('DAY', f.ORDER_DATE)
      ORDER BY a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM, ORDER_DATE
    `, binds);
  }

  // Distinct brand/category options available per company, for the dashboard
  // dropdowns. Built once at refresh from DIM_PRODUCTS × active accounts (small).
  private async refreshProductDims() {
    const data = await this.snowflake.query(`
      SELECT DISTINCT a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM, p.BRAND_NAME, p.PRODUCT_CATEGORY
      FROM GDEC_DATAMART.GOLD_SCHEMA.DIM_PRODUCTS p
      INNER JOIN ${ACCOUNTS_SQL} a ON p.SHOP_ID = a.SHOP_ID
      WHERE a.IS_ACTIVE = TRUE AND a.ACCOUNT_NAME != 's'
        AND p.BRAND_NAME IS NOT NULL AND p.BRAND_NAME != ''
        AND p.PRODUCT_CATEGORY IS NOT NULL AND p.PRODUCT_CATEGORY != ''
    `);
    this.cache.set('productDims', data);
    this.logger.log(`Product dims cached — ${data.length} rows`);
  }

  // Builds a repeat-purchase query at a chosen grain. byCompany/byPlatform pick
  // whether that dimension is a real column or collapsed to the RETENTION_ALL
  // sentinel — so we can produce (company,platform), (company,ALL), (ALL,platform)
  // and (ALL,ALL) rollups, each with buyer-order counts computed WITHIN that grain
  // (repeat rate is not additive, so every rollup must be aggregated directly).
  private retentionQuery(byCompany: boolean, byAccount: boolean, byPlatform: boolean): string {
    const co = byCompany ? 'a.COMPANY_NAME' : `'${RETENTION_ALL}'`;
    const ac = byAccount ? 'a.ACCOUNT_NAME' : `'${RETENTION_ALL}'`;
    const pl = byPlatform ? 'a.PLATFORM' : `'${RETENTION_ALL}'`;
    return `
      WITH b AS (
        SELECT
          ${co} AS COMPANY_NAME,
          ${ac} AS ACCOUNT_NAME,
          ${pl} AS PLATFORM,
          f.BUYER_ID AS SHOPPER,
          COUNT(DISTINCT f.PLATFORM_ORDER_ID) AS orders,
          SUM(f.ORIGINAL_PRODUCT_PRICE)       AS gmv
        FROM GDEC_ANALYTICS.DATA_QUALITY_RECOVERY.FACT_PLATFORM_ORDER_ITEMS_ENRICHED f
        INNER JOIN GDEC_DATAMART.GOLD_SCHEMA.DIM_MARKETPLACE_ACCOUNTS a ON f.SHOP_ID = a.SHOP_ID AND ${ONBOARD_FLOOR_SQL}
        WHERE f.ITEM_STATUS IN (${VALID_REVENUE_STATUS_SQL})
          AND ${RETENTION_FLOOR_SQL}
          AND a.IS_ACTIVE = TRUE
          AND a.ACCOUNT_NAME != 's'
          AND f.BUYER_ID IS NOT NULL
          AND UPPER(TRIM(f.BUYER_ID)) NOT IN ('0', 'N/A', 'NULL', '-1', '')
        GROUP BY ${co}, ${ac}, ${pl}, f.BUYER_ID
      )
      SELECT
        COMPANY_NAME,
        ACCOUNT_NAME,
        PLATFORM,
        COUNT(*)                                                         AS BUYERS,
        SUM(IFF(orders >= 2, 1, 0))                                      AS REPEAT_BUYERS,
        ROUND(100.0 * SUM(IFF(orders >= 2, 1, 0)) / NULLIF(COUNT(*),0), 1)          AS REPEAT_RATE,
        ROUND(100.0 * SUM(IFF(orders >= 2, gmv, 0)) / NULLIF(SUM(gmv),0), 1)        AS REPEAT_GMV_SHARE,
        ROUND(AVG(orders), 2)                                           AS AVG_ORDERS
      FROM b
      GROUP BY COMPANY_NAME, ACCOUNT_NAME, PLATFORM
    `;
  }

  // Precompute repeat-purchase metrics (trailing 12 mo) at every grain combination
  // and cache the union. Repeat rate is not additive, so each grain (company /
  // account / platform, each either real or the __ALL__ rollup) must be aggregated
  // directly — the frontend then picks the row matching the active company/account/
  // platform filter (#7: repeat purchase now responds to the account selector).
  private async refreshRetention() {
    const bools = [true, false];
    const grains: Array<[boolean, boolean, boolean]> = [];
    for (const c of bools) for (const a of bools) for (const p of bools) grains.push([c, a, p]);
    const rows: any[] = [];
    await this.mapPool(grains, this.WARM_CONCURRENCY, async ([byCompany, byAccount, byPlatform]) => {
      try {
        const part = await this.snowflake.query(this.retentionQuery(byCompany, byAccount, byPlatform));
        rows.push(...part);
      } catch (err) {
        this.logger.warn(`Retention[c=${byCompany},a=${byAccount},p=${byPlatform}] skipped: ${(err as Error).message}`);
      }
    });
    this.cache.set('retention', rows);
    this.logger.log(`Retention cached — ${rows.length} rows`);
  }

  // Pure Snowflake fetchers for time series — no caching here (policy lives in
  // loadWithCache / the getter). SQL copied verbatim from the old
  // refreshTimeSeries; tenant variant adds ONLY `AND a.COMPANY_NAME = ?`.
  // Shared SELECT/GROUP body for the timeseries queries. GMV (REVENUE) is gross —
  // includes cancelled — while ORDERS, ITEMS, REVENUE_VALID (the NMV base) and the
  // discount columns stay on VALID statuses via IFF guards. The frontend derives
  // NMV = REVENUE_VALID − platform − seller discount, and the date-aware Account
  // Breakdown / Shop Performance tables + the platform pie are aggregated from this
  // same (company, account, platform, day) grain so they always match the scorecards.
  private readonly TIMESERIES_BODY = `
        a.COMPANY_NAME,
        a.ACCOUNT_NAME,
        a.PLATFORM,
        DATE_TRUNC('DAY', f.ORDER_DATE)         AS ORDER_DATE,
        COUNT(DISTINCT IFF(${IS_VALID_SQL}, f.PLATFORM_ORDER_ID, NULL)) AS ORDERS,
        COUNT(IFF(${IS_VALID_SQL}, f.ORDER_ITEM_SK, NULL))             AS ITEMS,
        ROUND(SUM(f.ORIGINAL_PRODUCT_PRICE), 2)                         AS REVENUE,
        ROUND(SUM(IFF(${IS_VALID_SQL}, f.ORIGINAL_PRODUCT_PRICE, 0)), 2) AS REVENUE_VALID,
        ROUND(SUM(IFF(${IS_VALID_SQL}, f.PLATFORM_DISCOUNT, 0)), 2)              AS PLATFORM_DISCOUNT,
        ROUND(SUM(IFF(${IS_VALID_SQL}, f.SELLER_DISCOUNT, 0)), 2)                AS SELLER_DISCOUNT,
        ROUND(SUM(IFF(${IS_VALID_SQL}, f.PLATFORM_SHIPPING_FEE_DISCOUNT, 0)), 2) AS SHIPPING_DISCOUNT
      FROM GDEC_ANALYTICS.DATA_QUALITY_RECOVERY.FACT_PLATFORM_ORDER_ITEMS_ENRICHED f
      INNER JOIN GDEC_DATAMART.GOLD_SCHEMA.DIM_MARKETPLACE_ACCOUNTS a ON f.SHOP_ID = a.SHOP_ID AND ${ONBOARD_FLOOR_SQL}
      WHERE f.ITEM_STATUS IN (${GMV_STATUS_SQL})
      AND f.ORDER_DATE >= '2023-01-01'
      AND a.IS_ACTIVE = TRUE
      AND a.ACCOUNT_NAME != 's'`;

  private fetchAllTimeSeries(): Promise<any[]> {
    return this.snowflake.query(`
      SELECT ${this.TIMESERIES_BODY}
      GROUP BY a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM, DATE_TRUNC('DAY', f.ORDER_DATE)
      ORDER BY a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM, ORDER_DATE
    `);
  }

  private fetchTenantTimeSeries(companyName: string): Promise<any[]> {
    return this.snowflake.query(`
      SELECT ${this.TIMESERIES_BODY}
      AND a.COMPANY_NAME = ?
      GROUP BY a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM, DATE_TRUNC('DAY', f.ORDER_DATE)
      ORDER BY a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM, ORDER_DATE
    `, [companyName]);
  }

  // ── Brand / Category filter helpers ──────────────────────────────
  // Active only when a specific brand or category is chosen.
  private brandCatActive(brand?: string, category?: string): boolean {
    return (!!brand && brand !== 'all') || (!!category && category !== 'all');
  }
  // Extra WHERE fragments (and their bind params, in order) for the active filter.
  private brandCatWhere(brand?: string, category?: string): { sql: string; binds: any[] } {
    const parts: string[] = [];
    const binds: any[] = [];
    if (brand && brand !== 'all')       { parts.push('p.BRAND_NAME = ?');       binds.push(brand); }
    if (category && category !== 'all') { parts.push('p.PRODUCT_CATEGORY = ?'); binds.push(category); }
    return { sql: parts.length ? ' AND ' + parts.join(' AND ') : '', binds };
  }

  // Brand/category-aware timeseries. Same grain and measures as the lean fetchers
  // (so every timeseries-derived view — scorecards, trends, Account Breakdown, Shop
  // Performance, platform pie, discount cards — is filtered identically), but with
  // the DIM_PRODUCTS join and the brand/category WHERE. company=null → all tenants
  // (admin). Binds are ordered: [company?, brand?, category?].
  private fetchTimeSeriesEnriched(company: string | null, brand?: string, category?: string): Promise<any[]> {
    const bc = this.brandCatWhere(brand, category);
    const binds: any[] = [];
    const compSql = company ? ' AND a.COMPANY_NAME = ?' : '';
    if (company) binds.push(company);
    binds.push(...bc.binds);
    return this.snowflake.query(`
      SELECT
        a.COMPANY_NAME,
        a.ACCOUNT_NAME,
        a.PLATFORM,
        DATE_TRUNC('DAY', f.ORDER_DATE)         AS ORDER_DATE,
        COUNT(DISTINCT IFF(${IS_VALID_SQL}, f.PLATFORM_ORDER_ID, NULL)) AS ORDERS,
        COUNT(IFF(${IS_VALID_SQL}, f.ORDER_ITEM_SK, NULL))             AS ITEMS,
        ROUND(SUM(f.ORIGINAL_PRODUCT_PRICE), 2)                         AS REVENUE,
        ROUND(SUM(IFF(${IS_VALID_SQL}, f.ORIGINAL_PRODUCT_PRICE, 0)), 2) AS REVENUE_VALID,
        ROUND(SUM(IFF(${IS_VALID_SQL}, f.PLATFORM_DISCOUNT, 0)), 2)              AS PLATFORM_DISCOUNT,
        ROUND(SUM(IFF(${IS_VALID_SQL}, f.SELLER_DISCOUNT, 0)), 2)                AS SELLER_DISCOUNT,
        ROUND(SUM(IFF(${IS_VALID_SQL}, f.PLATFORM_SHIPPING_FEE_DISCOUNT, 0)), 2) AS SHIPPING_DISCOUNT
      FROM ${FACT_SQL} f
      INNER JOIN ${ACCOUNTS_SQL} a ON f.SHOP_ID = a.SHOP_ID AND ${ONBOARD_FLOOR_SQL}
      ${PRODUCT_DIM_JOIN}
      WHERE f.ITEM_STATUS IN (${GMV_STATUS_SQL})
      AND f.ORDER_DATE >= '2023-01-01'
      AND a.IS_ACTIVE = TRUE
      AND a.ACCOUNT_NAME != 's'${compSql}${bc.sql}
      GROUP BY a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM, DATE_TRUNC('DAY', f.ORDER_DATE)
      ORDER BY a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM, ORDER_DATE
    `, binds);
  }

  private async refreshShops() {
    const data = await this.snowflake.query(`
      SELECT
        a.COMPANY_NAME,
        a.ACCOUNT_NAME,
        a.PLATFORM,
        a.SHOP_ID,
        a.SHOP_NAME,
        COUNT(DISTINCT f.PLATFORM_ORDER_ID)                                              AS ORDERS,
        COUNT(f.ORDER_ITEM_SK)                                                           AS ITEMS,
        ROUND(SUM(f.ORIGINAL_PRODUCT_PRICE), 2)                                         AS REVENUE,
        ROUND(SUM(f.ORIGINAL_PRODUCT_PRICE) / NULLIF(COUNT(DISTINCT f.PLATFORM_ORDER_ID), 0), 2) AS AOV
      FROM GDEC_ANALYTICS.DATA_QUALITY_RECOVERY.FACT_PLATFORM_ORDER_ITEMS_ENRICHED f
      INNER JOIN GDEC_DATAMART.GOLD_SCHEMA.DIM_MARKETPLACE_ACCOUNTS a ON f.SHOP_ID = a.SHOP_ID AND ${ONBOARD_FLOOR_SQL}
      WHERE f.ITEM_STATUS IN (${VALID_REVENUE_STATUS_SQL})
      AND f.ORDER_DATE >= '2023-01-01'
      AND a.IS_ACTIVE = TRUE
      AND a.ACCOUNT_NAME != 's'
      GROUP BY a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM, a.SHOP_ID, a.SHOP_NAME
      ORDER BY a.COMPANY_NAME, REVENUE DESC
    `);
    this.cache.set('shops', data);
    this.logger.log(`Shops cached — ${data.length} rows`);
  }

  private async refreshProducts() {
    const data = await this.snowflake.query(`
      SELECT
        a.COMPANY_NAME,
        a.ACCOUNT_NAME,
        a.PLATFORM,
        f.PRODUCT_NAME,
        COUNT(DISTINCT f.PLATFORM_ORDER_ID)     AS ORDERS,
        COUNT(f.ORDER_ITEM_SK)                  AS UNITS,
        ROUND(SUM(f.ORIGINAL_PRODUCT_PRICE), 2) AS REVENUE,
        ROUND(AVG(f.ORIGINAL_PRODUCT_PRICE), 2) AS ASP
      FROM GDEC_ANALYTICS.DATA_QUALITY_RECOVERY.FACT_PLATFORM_ORDER_ITEMS_ENRICHED f
      INNER JOIN GDEC_DATAMART.GOLD_SCHEMA.DIM_MARKETPLACE_ACCOUNTS a ON f.SHOP_ID = a.SHOP_ID AND ${ONBOARD_FLOOR_SQL}
      WHERE f.ITEM_STATUS IN (${VALID_REVENUE_STATUS_SQL})
      AND f.ORDER_DATE >= '2023-01-01'
      AND a.IS_ACTIVE = TRUE
      AND a.ACCOUNT_NAME != 's'
      GROUP BY a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM, f.PRODUCT_NAME
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM
        ORDER BY SUM(f.ORIGINAL_PRODUCT_PRICE) DESC
      ) <= 10
      ORDER BY a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM, REVENUE DESC
    `);
    this.cache.set('products', data);
    this.logger.log(`Products cached — ${data.length} rows`);
  }

  private normaliseProvince(raw: string): string {
  if (!raw) return 'Unknown';
  // Masked Cavite entry
  if (raw === 'C****e') return 'Cavite';
  // TikTok stores Manila as a separate entry — roll into Metro Manila
  if (raw === 'Manila') return 'Metro Manila';
  // Shopee stores city-level Metro Manila entries e.g. Metro Manila~Quezon City
  if (raw.startsWith('Metro Manila~')) return 'Metro Manila';
  return raw;
}

private geoQuery(dateFloor: string): string {
  return `
    SELECT
      a.COMPANY_NAME,
      a.ACCOUNT_NAME,
      a.PLATFORM,
      f.SHIPPING_PROVINCE,
      COUNT(DISTINCT f.PLATFORM_ORDER_ID)     AS ORDERS,
      ROUND(SUM(f.ORIGINAL_PRODUCT_PRICE), 2) AS REVENUE
    FROM GDEC_ANALYTICS.DATA_QUALITY_RECOVERY.FACT_PLATFORM_ORDER_ITEMS_ENRICHED f
    INNER JOIN GDEC_DATAMART.GOLD_SCHEMA.DIM_MARKETPLACE_ACCOUNTS a ON f.SHOP_ID = a.SHOP_ID AND ${ONBOARD_FLOOR_SQL}
    WHERE f.ITEM_STATUS IN (${VALID_REVENUE_STATUS_SQL})
    AND ${dateFloor}
    AND a.IS_ACTIVE = TRUE
    AND a.ACCOUNT_NAME != 's'
    AND f.SHIPPING_PROVINCE IS NOT NULL
    AND f.SHIPPING_PROVINCE != ''
    GROUP BY a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM, f.SHIPPING_PROVINCE
    ORDER BY a.COMPANY_NAME, REVENUE DESC
  `;
}

// Precompute Sales-by-Province for every time window and cache each under
// `geo:<period>`. Same small province-level aggregate per window; windows warm
// in a bounded pool (WARM_CONCURRENCY) and fail-soft per window like personas.
private async refreshGeo() {
  await this.mapPool(Object.entries(GEO_PERIODS), this.WARM_CONCURRENCY, async ([period, floor]) => {
    try {
      const data = await this.snowflake.query(this.geoQuery(floor));
      const result = this.normaliseGeoRows(data);
      this.cache.set(`geo:${period}`, result);
      this.logger.log(`Geo[${period}] cached — ${result.length} rows`);
    } catch (err) {
      this.cache.set(`geo:${period}`, []);
      this.logger.warn(`Geo[${period}] refresh skipped: ${(err as Error).message}`);
    }
  });
}

// Normalise province names and merge duplicates (shared by the precompute and the
// on-demand brand/category-filtered geo path).
private normaliseGeoRows(data: any[]): any[] {
  const merged: Record<string, any> = {};
  data.forEach((r: any) => {
    const province = this.normaliseProvince(r.SHIPPING_PROVINCE);
    const key = `${r.COMPANY_NAME}|${r.ACCOUNT_NAME}|${r.PLATFORM}|${province}`;
    if (!merged[key]) {
      merged[key] = {
        COMPANY_NAME: r.COMPANY_NAME, ACCOUNT_NAME: r.ACCOUNT_NAME, PLATFORM: r.PLATFORM,
        SHIPPING_PROVINCE: province, ORDERS: 0, REVENUE: 0,
      };
    }
    merged[key].ORDERS  += Number(r.ORDERS);
    merged[key].REVENUE += Number(r.REVENUE);
  });
  return Object.values(merged);
}

// Brand/category-aware Sales-by-Province, on demand. Same province aggregate as the
// precompute + the DIM_PRODUCTS join and brand/category WHERE; normalised the same
// way. company=null → all tenants (admin).
private async fetchGeoEnriched(company: string | null, dateFloor: string, brand?: string, category?: string): Promise<any[]> {
  const bc = this.brandCatWhere(brand, category);
  const binds: any[] = [];
  const compSql = company ? ' AND a.COMPANY_NAME = ?' : '';
  if (company) binds.push(company);
  binds.push(...bc.binds);
  const rows = await this.snowflake.query(`
    SELECT
      a.COMPANY_NAME,
      a.ACCOUNT_NAME,
      a.PLATFORM,
      f.SHIPPING_PROVINCE,
      COUNT(DISTINCT f.PLATFORM_ORDER_ID)     AS ORDERS,
      ROUND(SUM(f.ORIGINAL_PRODUCT_PRICE), 2) AS REVENUE
    FROM ${FACT_SQL} f
    INNER JOIN ${ACCOUNTS_SQL} a ON f.SHOP_ID = a.SHOP_ID AND ${ONBOARD_FLOOR_SQL}
    ${PRODUCT_DIM_JOIN}
    WHERE f.ITEM_STATUS IN (${VALID_REVENUE_STATUS_SQL})
    AND ${dateFloor}
    AND a.IS_ACTIVE = TRUE
    AND a.ACCOUNT_NAME != 's'
    AND f.SHIPPING_PROVINCE IS NOT NULL
    AND f.SHIPPING_PROVINCE != ''${compSql}${bc.sql}
    GROUP BY a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM, f.SHIPPING_PROVINCE
    ORDER BY a.COMPANY_NAME, REVENUE DESC
  `, binds);
  return this.normaliseGeoRows(rows);
}

// Brand/category-aware repeat purchase, on demand, for ONE active scope (company /
// account / platform, each optional) over the trailing 12 months. Returns a single
// aggregated row {BUYERS, REPEAT_BUYERS, REPEAT_RATE, REPEAT_GMV_SHARE, AVG_ORDERS}.
// "Repeat" here = a buyer with ≥2 orders OF THE FILTERED brand/category in-window.
private fetchRetentionFiltered(
  company: string | null, account: string | null, platform: string | null,
  brand?: string, category?: string,
): Promise<any[]> {
  const bc = this.brandCatWhere(brand, category);
  const binds: any[] = [];
  const scope: string[] = [];
  if (company)  { scope.push('a.COMPANY_NAME = ?'); binds.push(company); }
  if (account)  { scope.push('a.ACCOUNT_NAME = ?'); binds.push(account); }
  if (platform) { scope.push('a.PLATFORM = ?');     binds.push(platform); }
  binds.push(...bc.binds);
  const scopeSql = scope.length ? ' AND ' + scope.join(' AND ') : '';
  return this.snowflake.query(`
    WITH b AS (
      SELECT
        f.BUYER_ID AS SHOPPER,
        COUNT(DISTINCT f.PLATFORM_ORDER_ID) AS orders,
        SUM(f.ORIGINAL_PRODUCT_PRICE)       AS gmv
      FROM ${FACT_SQL} f
      INNER JOIN ${ACCOUNTS_SQL} a ON f.SHOP_ID = a.SHOP_ID AND ${ONBOARD_FLOOR_SQL}
      ${PRODUCT_DIM_JOIN}
      WHERE f.ITEM_STATUS IN (${VALID_REVENUE_STATUS_SQL})
        AND ${RETENTION_FLOOR_SQL}
        AND a.IS_ACTIVE = TRUE
        AND a.ACCOUNT_NAME != 's'
        AND f.BUYER_ID IS NOT NULL
        AND UPPER(TRIM(f.BUYER_ID)) NOT IN ('0', 'N/A', 'NULL', '-1', '')${scopeSql}${bc.sql}
      GROUP BY f.BUYER_ID
    )
    SELECT
      COUNT(*)                                                              AS BUYERS,
      SUM(IFF(orders >= 2, 1, 0))                                           AS REPEAT_BUYERS,
      ROUND(100.0 * SUM(IFF(orders >= 2, 1, 0)) / NULLIF(COUNT(*),0), 1)     AS REPEAT_RATE,
      ROUND(100.0 * SUM(IFF(orders >= 2, gmv, 0)) / NULLIF(SUM(gmv),0), 1)   AS REPEAT_GMV_SHARE,
      ROUND(AVG(orders), 2)                                                 AS AVG_ORDERS
    FROM b
  `, binds);
}

// New vs existing buyers for the active scope over the selected date range.
// A buyer active in [from, to] is "new" when their FIRST-EVER order in scope
// (2023 onward) falls within that range, otherwise "existing" (acquired earlier,
// purchasing again now). Returns one aggregated row. Date-range dependent, so it
// cannot use the nightly precompute — computed on demand like retention-filtered.
private fetchNewVsExisting(
  company: string | null, account: string | null, platform: string | null,
  from: string, to: string, brand?: string, category?: string,
): Promise<any[]> {
  const bc = this.brandCatWhere(brand, category);
  const scope: string[] = [];
  const scopeBinds: any[] = [];
  if (company)  { scope.push('a.COMPANY_NAME = ?'); scopeBinds.push(company); }
  if (account)  { scope.push('a.ACCOUNT_NAME = ?'); scopeBinds.push(account); }
  if (platform) { scope.push('a.PLATFORM = ?');     scopeBinds.push(platform); }
  const scopeSql = scope.length ? ' AND ' + scope.join(' AND ') : '';
  const buyerGuard = `f.BUYER_ID IS NOT NULL AND UPPER(TRIM(f.BUYER_ID)) NOT IN ('0', 'N/A', 'NULL', '-1', '')`;
  // Bind order must match the ? order in the SQL below.
  const binds: any[] = [
    ...scopeBinds, ...bc.binds,              // firsts CTE
    from, to, ...scopeBinds, ...bc.binds,    // active CTE
    from, from, from, from,                  // final SELECT (new/existing counts & rates)
  ];
  return this.snowflake.query(`
    WITH firsts AS (
      SELECT f.BUYER_ID AS SHOPPER, MIN(f.ORDER_DATE) AS first_order
      FROM ${FACT_SQL} f
      INNER JOIN ${ACCOUNTS_SQL} a ON f.SHOP_ID = a.SHOP_ID AND ${ONBOARD_FLOOR_SQL}
      ${PRODUCT_DIM_JOIN}
      WHERE f.ITEM_STATUS IN (${VALID_REVENUE_STATUS_SQL})
        AND f.ORDER_DATE >= '2023-01-01'
        AND a.IS_ACTIVE = TRUE AND a.ACCOUNT_NAME != 's'
        AND ${buyerGuard}${scopeSql}${bc.sql}
      GROUP BY f.BUYER_ID
    ),
    active AS (
      SELECT DISTINCT f.BUYER_ID AS SHOPPER
      FROM ${FACT_SQL} f
      INNER JOIN ${ACCOUNTS_SQL} a ON f.SHOP_ID = a.SHOP_ID AND ${ONBOARD_FLOOR_SQL}
      ${PRODUCT_DIM_JOIN}
      WHERE f.ITEM_STATUS IN (${VALID_REVENUE_STATUS_SQL})
        AND f.ORDER_DATE >= ? AND f.ORDER_DATE <= ?
        AND a.IS_ACTIVE = TRUE AND a.ACCOUNT_NAME != 's'
        AND ${buyerGuard}${scopeSql}${bc.sql}
    )
    SELECT
      COUNT(*)                                                                 AS BUYERS,
      SUM(IFF(fr.first_order >= ?, 1, 0))                                       AS NEW_BUYERS,
      SUM(IFF(fr.first_order <  ?, 1, 0))                                       AS EXISTING_BUYERS,
      ROUND(100.0 * SUM(IFF(fr.first_order >= ?, 1, 0)) / NULLIF(COUNT(*),0), 1) AS NEW_RATE,
      ROUND(100.0 * SUM(IFF(fr.first_order <  ?, 1, 0)) / NULLIF(COUNT(*),0), 1) AS EXISTING_RATE
    FROM active ac
    INNER JOIN firsts fr ON ac.SHOPPER = fr.SHOPPER
  `, binds);
}

// Brand/category-aware personas (RFM), on demand. Same scoring as personaQuery but
// with the DIM_PRODUCTS join + brand/category filter inside the shopper CTE. Note:
// the ≥500-buyer segment gate still applies, so narrow brand filters may leave few
// or no qualifying (company, platform) segments — the UI shows its "no data" state.
private personaQueryEnriched(dateFloor: string, brand?: string, category?: string): { sql: string; binds: any[] } {
  const base = this.personaQuery(dateFloor);
  const bc = this.brandCatWhere(brand, category);
  // Inject the dim join right after the shopper CTE's accounts join, and the
  // brand/category predicate into that CTE's WHERE (keyed off the shared date floor).
  const sql = base
    .replace(
      `INNER JOIN GDEC_DATAMART.GOLD_SCHEMA.DIM_MARKETPLACE_ACCOUNTS a ON f.SHOP_ID = a.SHOP_ID AND ${ONBOARD_FLOOR_SQL}`,
      `INNER JOIN GDEC_DATAMART.GOLD_SCHEMA.DIM_MARKETPLACE_ACCOUNTS a ON f.SHOP_ID = a.SHOP_ID AND ${ONBOARD_FLOOR_SQL}\n        ${PRODUCT_DIM_JOIN}`,
    )
    .replace(`AND ${dateFloor}`, `AND ${dateFloor}${bc.sql}`);
  return { sql, binds: bc.binds };
}

// Pure Snowflake fetchers for discounts — no caching here (policy lives in
// loadWithCache / the getter). SQL copied verbatim from the old
// refreshDiscounts; tenant variant adds ONLY `AND a.COMPANY_NAME = ?`.
private fetchAllDiscounts(): Promise<any[]> {
  return this.snowflake.query(`
    SELECT
      a.COMPANY_NAME,
      a.ACCOUNT_NAME,
      a.PLATFORM,
      DATE_TRUNC('DAY', f.ORDER_DATE)                  AS ORDER_DATE,
      ROUND(SUM(f.PLATFORM_DISCOUNT), 2)               AS PLATFORM_DISCOUNT,
      ROUND(SUM(f.SELLER_DISCOUNT), 2)                 AS SELLER_DISCOUNT,
      ROUND(SUM(f.PLATFORM_SHIPPING_FEE_DISCOUNT), 2)  AS SHIPPING_DISCOUNT,
      ROUND(SUM(f.SELLER_SHIPPING_FEE_DISCOUNT), 2)    AS SELLER_SHIPPING_DISCOUNT
    FROM GDEC_ANALYTICS.DATA_QUALITY_RECOVERY.FACT_PLATFORM_ORDER_ITEMS_ENRICHED f
    INNER JOIN GDEC_DATAMART.GOLD_SCHEMA.DIM_MARKETPLACE_ACCOUNTS a ON f.SHOP_ID = a.SHOP_ID AND ${ONBOARD_FLOOR_SQL}
    WHERE f.ITEM_STATUS IN (${VALID_REVENUE_STATUS_SQL})
    AND f.ORDER_DATE >= '2023-01-01'
    AND a.IS_ACTIVE = TRUE
    AND a.ACCOUNT_NAME != 's'
    GROUP BY a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM, DATE_TRUNC('DAY', f.ORDER_DATE)
    ORDER BY a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM, ORDER_DATE
  `);
}

private fetchTenantDiscounts(companyName: string): Promise<any[]> {
  return this.snowflake.query(`
    SELECT
      a.COMPANY_NAME,
      a.ACCOUNT_NAME,
      a.PLATFORM,
      DATE_TRUNC('DAY', f.ORDER_DATE)                  AS ORDER_DATE,
      ROUND(SUM(f.PLATFORM_DISCOUNT), 2)               AS PLATFORM_DISCOUNT,
      ROUND(SUM(f.SELLER_DISCOUNT), 2)                 AS SELLER_DISCOUNT,
      ROUND(SUM(f.PLATFORM_SHIPPING_FEE_DISCOUNT), 2)  AS SHIPPING_DISCOUNT,
      ROUND(SUM(f.SELLER_SHIPPING_FEE_DISCOUNT), 2)    AS SELLER_SHIPPING_DISCOUNT
    FROM GDEC_ANALYTICS.DATA_QUALITY_RECOVERY.FACT_PLATFORM_ORDER_ITEMS_ENRICHED f
    INNER JOIN GDEC_DATAMART.GOLD_SCHEMA.DIM_MARKETPLACE_ACCOUNTS a ON f.SHOP_ID = a.SHOP_ID AND ${ONBOARD_FLOOR_SQL}
    WHERE f.ITEM_STATUS IN (${VALID_REVENUE_STATUS_SQL})
    AND f.ORDER_DATE >= '2023-01-01'
    AND a.IS_ACTIVE = TRUE
    AND a.ACCOUNT_NAME != 's'
    AND a.COMPANY_NAME = ?
    GROUP BY a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM, DATE_TRUNC('DAY', f.ORDER_DATE)
    ORDER BY a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM, ORDER_DATE
  `, [companyName]);
}

// Brand/category-aware discounts (for the Total-Discounts-by-Month chart), same
// shape as the lean fetchers + the DIM_PRODUCTS join and brand/category WHERE.
private fetchDiscountsEnriched(company: string | null, brand?: string, category?: string): Promise<any[]> {
  const bc = this.brandCatWhere(brand, category);
  const binds: any[] = [];
  const compSql = company ? ' AND a.COMPANY_NAME = ?' : '';
  if (company) binds.push(company);
  binds.push(...bc.binds);
  return this.snowflake.query(`
    SELECT
      a.COMPANY_NAME,
      a.ACCOUNT_NAME,
      a.PLATFORM,
      DATE_TRUNC('DAY', f.ORDER_DATE)                  AS ORDER_DATE,
      ROUND(SUM(f.PLATFORM_DISCOUNT), 2)               AS PLATFORM_DISCOUNT,
      ROUND(SUM(f.SELLER_DISCOUNT), 2)                 AS SELLER_DISCOUNT,
      ROUND(SUM(f.PLATFORM_SHIPPING_FEE_DISCOUNT), 2)  AS SHIPPING_DISCOUNT,
      ROUND(SUM(f.SELLER_SHIPPING_FEE_DISCOUNT), 2)    AS SELLER_SHIPPING_DISCOUNT
    FROM ${FACT_SQL} f
    INNER JOIN ${ACCOUNTS_SQL} a ON f.SHOP_ID = a.SHOP_ID AND ${ONBOARD_FLOOR_SQL}
    ${PRODUCT_DIM_JOIN}
    WHERE f.ITEM_STATUS IN (${VALID_REVENUE_STATUS_SQL})
    AND f.ORDER_DATE >= '2023-01-01'
    AND a.IS_ACTIVE = TRUE
    AND a.ACCOUNT_NAME != 's'${compSql}${bc.sql}
    GROUP BY a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM, DATE_TRUNC('DAY', f.ORDER_DATE)
    ORDER BY a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM, ORDER_DATE
  `, binds);
}

  private async refreshAccounts() {
    const data = await this.snowflake.query(`
      SELECT DISTINCT
        COMPANY_NAME, ACCOUNT_NAME, PLATFORM,
        SHOP_ID, SHOP_NAME, IS_ACTIVE,
        ACCOUNT_CATEGORY, BUSINESS_MODEL
      FROM GDEC_DATAMART.GOLD_SCHEMA.DIM_MARKETPLACE_ACCOUNTS
      WHERE IS_ACTIVE = TRUE AND ACCOUNT_NAME != 's'
      ORDER BY COMPANY_NAME, ACCOUNT_NAME, PLATFORM
    `);
    this.cache.set('accounts', data);
    this.logger.log(`Accounts cached — ${data.length} rows`);
  }

  private async refreshDoi() {
    const data = await this.snowflake.query(`
      WITH inventory AS (
        SELECT
          CUSTOMER_ID,
          PRODUCT_SKU,
          MAX(PRODUCT_NAME) AS PRODUCT_NAME,
          SUM(TOTAL_QUANTITY) AS INVENTORY_QTY
        FROM GDEC_DATAMART.GOLD_SCHEMA.FACT_WMS_INVENTORY
        WHERE IS_ACTIVE = TRUE
        GROUP BY CUSTOMER_ID, PRODUCT_SKU
        HAVING SUM(TOTAL_QUANTITY) > 0
      ),
      orders_3m AS (
        SELECT
          CUSTOMER_ID,
          PRODUCT_SKU,
          SUM(QUANTITY_ORDERED) AS QTY_ORDERED_3M
        FROM GDEC_DATAMART.GOLD_SCHEMA.FACT_WMS_ORDER_ITEMS
        WHERE ORDER_CREATED_AT_PHT >= DATEADD('day', -90, CURRENT_DATE())
        GROUP BY CUSTOMER_ID, PRODUCT_SKU
      )
      SELECT
        i.CUSTOMER_ID,
        i.PRODUCT_SKU,
        i.PRODUCT_NAME,
        i.INVENTORY_QTY,
        COALESCE(o.QTY_ORDERED_3M, 0) AS ORDERED_3M,
        ROUND(COALESCE(o.QTY_ORDERED_3M, 0) / 90, 2) AS DAILY_AVG_SOLD,
        CASE
          WHEN COALESCE(o.QTY_ORDERED_3M, 0) = 0 THEN NULL
          ELSE ROUND(i.INVENTORY_QTY / (o.QTY_ORDERED_3M / 90), 1)
        END AS DOI
      FROM inventory i
      LEFT JOIN orders_3m o
        ON i.CUSTOMER_ID = o.CUSTOMER_ID
        AND i.PRODUCT_SKU = o.PRODUCT_SKU
      ORDER BY i.CUSTOMER_ID, DOI ASC NULLS LAST
    `);

    // Tag each DOI row with its owning company/accounts via the OP_CHN_MAP_V2
    // crosswalk (SC_ID = marketplace SHOP_ID, CUST_ID = WMS CUSTOMER_ID). This
    // replaces the broken per-user CUSTOMER_ID_MAP: DOI is now isolated by
    // COMPANY_NAME like every other dataset. A CUST_ID shared across >1 company
    // (or unresolved) gets COMPANY_NAME = null so tenants can't see it; admins
    // bypass the filter in getDoi and still see everything.
    const crosswalk = await this.snowflake.query(`
      SELECT DISTINCT m.CUST_ID, a.COMPANY_NAME, a.ACCOUNT_NAME
      FROM GDEC_ANALYTICS.SANDBOX.OP_CHN_MAP_V2 m
      INNER JOIN GDEC_DATAMART.GOLD_SCHEMA.DIM_MARKETPLACE_ACCOUNTS a
        ON a.SHOP_ID::string = m.SC_ID::string
      WHERE m.SC_ID != '' AND m.CUST_ID != '' AND a.IS_ACTIVE = TRUE AND a.ACCOUNT_NAME != 's'
    `);

    const custMap = new Map<string, { companies: Set<string>; accounts: Set<string> }>();
    for (const row of crosswalk as any[]) {
      let entry = custMap.get(row.CUST_ID);
      if (!entry) {
        entry = { companies: new Set(), accounts: new Set() };
        custMap.set(row.CUST_ID, entry);
      }
      entry.companies.add(row.COMPANY_NAME);
      entry.accounts.add(row.ACCOUNT_NAME);
    }

    for (const r of data as any[]) {
      const entry = custMap.get(r.CUSTOMER_ID);
      if (entry && entry.companies.size === 1) {
        r.COMPANY_NAME = [...entry.companies][0];
        r.ACCOUNT_NAMES = [...entry.accounts];
      } else {
        r.COMPANY_NAME = null; // shared across companies or unresolved → tenant-restricted
        r.ACCOUNT_NAMES = [];
      }
    }

    this.cache.set('doi', data);
    const visible = (data as any[]).filter(r => r.COMPANY_NAME).length;
    this.logger.log(`DOI cached — ${data.length} rows (${visible} tenant-visible, ${custMap.size} CUST_IDs mapped)`);
  }

  // ── Lazy-cache plumbing (timeseries/discounts) ───────────────────

  // THE single caching seam. Switch to pure on-demand with TENANT_CACHE=ondemand
  // (early return below) — no code change. Bounded by TTL (time) and MAX_TENANTS (count).
  private async loadWithCache(
    store: Map<string, { data: any[]; expiresAt: number }>,
    inflight: Map<string, Promise<any[]>>,
    key: string,
    fetchFn: (k: string) => Promise<any[]>,
    label: string,
  ): Promise<any[]> {
    if (this.TENANT_CACHE_MODE === 'ondemand') return fetchFn(key);

    const entry = store.get(key);
    if (entry && Date.now() <= entry.expiresAt) {
      store.delete(key);
      store.set(key, entry); // promote to most-recently-used
      const ageMin = Math.round((this.TTL_MS - (entry.expiresAt - Date.now())) / 60000);
      this.logger.log(`[${label}] cache HIT company="${key}" age=${ageMin}m size=${store.size}/${this.MAX_TENANTS}`);
      return entry.data;
    }
    if (entry) store.delete(key); // expired

    const existing = inflight.get(key);
    if (existing) return existing; // de-dupe concurrent misses

    this.logger.log(`[${label}] cache MISS company="${key}" -> Snowflake`);
    const p = fetchFn(key)
      .then(data => {
        store.delete(key);
        store.set(key, { data, expiresAt: Date.now() + this.TTL_MS }); // re-insert at MRU end
        while (store.size > this.MAX_TENANTS) {
          const oldest = store.keys().next().value as string; // oldest = first key
          store.delete(oldest);
          this.logger.log(`[${label}] cache EVICT company="${oldest}" (LRU, size>${this.MAX_TENANTS})`);
        }
        return data;
      })
      .finally(() => inflight.delete(key)); // always clear, even on failure
    inflight.set(key, p); // register BEFORE returning so concurrent callers see it
    return p;
  }

  // Serializes heavy admin (all-tenant) loads so two can't spike memory at once.
  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.adminMutex.then(fn, fn);
    this.adminMutex = run.catch(() => {}); // chain continues even if one load fails
    return run;
  }

  // Drop all per-tenant slices (called by the nightly cron so data refreshes).
  private clearLazyCaches() {
    this.timeseriesByCompany.clear();
    this.discountsByCompany.clear();
    this.timeseriesInflight.clear();
    this.discountsInflight.clear();
    this.productsRankedCache.clear();
    this.productsRankedInflight.clear();
    this.timeseriesBCByCompany.clear();
    this.timeseriesBCInflight.clear();
    this.discountsBCByCompany.clear();
    this.discountsBCInflight.clear();
    this.cancellationsBCByCompany.clear();
    this.cancellationsBCInflight.clear();
    this.geoBCCache.clear();
    this.geoBCInflight.clear();
    this.retentionBCCache.clear();
    this.retentionBCInflight.clear();
    this.personasBCCache.clear();
    this.personasBCInflight.clear();
    this.newVsExistingCache.clear();
    this.newVsExistingInflight.clear();
    this.logger.log('Lazy per-tenant caches cleared (timeseries, discounts, products-ranked, brand/category variants)');
  }

  // ── Top Products (date-aware, cross-platform merged) ─────────────
  // Builds the ranked-products SQL for the active scope. Measures mirror the GMV
  // decision: REVENUE is gross GMV (incl. cancelled, from the widened WHERE), while
  // ORDERS/UNITS/ASP stay on valid rows. Grouping by PRODUCT_NAME only merges the
  // same product across SKUs AND platforms/accounts (#6); a platform/account filter
  // narrows the scope so the merge happens within it. PLATFORM_COUNT lets the UI
  // show "Multi" when a merged product spans platforms.
  private fetchProductsRanked(
    from: string, to: string,
    company: string | null, platform: string | null, account: string | null,
    brand?: string, category?: string, cap = 50,
  ): Promise<any[]> {
    // `cap` is set server-side (50 for Top Products, 1000 for the "all assortment"
    // view) — never from raw user input — so it is safe to inline in the SQL.
    const rankCap = cap === 1000 ? 1000 : 50;
    const where = [
      `f.ITEM_STATUS IN (${GMV_STATUS_SQL})`,
      `f.ORDER_DATE >= ?`,
      `f.ORDER_DATE <= ?`,
      `a.IS_ACTIVE = TRUE`,
      `a.ACCOUNT_NAME != 's'`,
      `f.PRODUCT_NAME IS NOT NULL`,
      `f.PRODUCT_NAME != ''`,
    ];
    const binds: any[] = [from, to];
    if (company)  { where.push(`a.COMPANY_NAME = ?`); binds.push(company); }
    if (platform) { where.push(`a.PLATFORM = ?`);     binds.push(platform); }
    if (account)  { where.push(`a.ACCOUNT_NAME = ?`); binds.push(account); }
    // Brand/category: add the DIM_PRODUCTS join + filter only when one is active.
    const bc = this.brandCatWhere(brand, category);
    const dimJoin = bc.sql ? PRODUCT_DIM_JOIN : '';
    if (bc.sql) { where.push(bc.sql.replace(/^ AND /, '')); binds.push(...bc.binds); }
    const sql = `
      SELECT
        f.PRODUCT_NAME,
        COUNT(DISTINCT IFF(${IS_VALID_SQL}, f.PLATFORM_ORDER_ID, NULL)) AS ORDERS,
        COUNT(IFF(${IS_VALID_SQL}, f.ORDER_ITEM_SK, NULL))             AS UNITS,
        ROUND(SUM(f.ORIGINAL_PRODUCT_PRICE), 2)                         AS REVENUE,
        ROUND(SUM(IFF(${IS_VALID_SQL}, f.ORIGINAL_PRODUCT_PRICE, 0))
              / NULLIF(COUNT(IFF(${IS_VALID_SQL}, f.ORDER_ITEM_SK, NULL)), 0), 2) AS ASP,
        COUNT(DISTINCT f.PLATFORM)                                      AS PLATFORM_COUNT,
        ANY_VALUE(f.PLATFORM)                                           AS PLATFORM,
        -- SKU code for the Top Products table. Rows are merged by PRODUCT_NAME across
        -- SKUs/platforms, so expose a representative SKU plus a distinct-SKU count the
        -- UI can use to flag a name that spans more than one SKU.
        ANY_VALUE(f.SELLER_SKU)                                         AS PRODUCT_SKU,
        COUNT(DISTINCT f.SELLER_SKU)                                    AS SKU_COUNT
      FROM GDEC_ANALYTICS.DATA_QUALITY_RECOVERY.FACT_PLATFORM_ORDER_ITEMS_ENRICHED f
      INNER JOIN GDEC_DATAMART.GOLD_SCHEMA.DIM_MARKETPLACE_ACCOUNTS a ON f.SHOP_ID = a.SHOP_ID AND ${ONBOARD_FLOOR_SQL}
      ${dimJoin}
      WHERE ${where.join(' AND ')}
      GROUP BY f.PRODUCT_NAME
      QUALIFY ROW_NUMBER() OVER (ORDER BY SUM(f.ORIGINAL_PRODUCT_PRICE) DESC) <= ${rankCap}
      ORDER BY REVENUE DESC
    `;
    return this.snowflake.query(sql, binds);
  }

  // ── PUBLIC GETTERS ──────────────────────────────────────────────

 getKpis(companyName: string, isAdmin: boolean, dateFrom?: string, dateTo?: string) {
    const data = (this.cache.get('kpis') || []) as any[];
    return this.filterCompany(data, companyName, isAdmin);
  }

  async getTimeSeries(companyName: string, isAdmin: boolean, dateFrom?: string, dateTo?: string, brand?: string, category?: string) {
  let data: any[];
  if (this.brandCatActive(brand, category)) {
    // On-demand brand/category-filtered variant (DIM_PRODUCTS join), cached per
    // (company, brand, category). Admin scans all tenants, serialized.
    const key = `${companyName}|${brand || 'all'}|${category || 'all'}`;
    data = isAdmin
      ? await this.runExclusive(() => this.fetchTimeSeriesEnriched(null, brand, category))
      : await this.loadWithCache(
          this.timeseriesBCByCompany, this.timeseriesBCInflight,
          key, () => this.fetchTimeSeriesEnriched(companyName, brand, category), 'timeseries-bc',
        );
  } else {
    data = isAdmin
      ? await this.runExclusive(() => this.fetchAllTimeSeries()) // all tenants, serialized, uncached
      : await this.loadWithCache(
          this.timeseriesByCompany, this.timeseriesInflight,
          companyName, c => this.fetchTenantTimeSeries(c), 'timeseries',
        );
  }
  return this.filterAndDate(data, companyName, isAdmin, dateFrom, dateTo, 'ORDER_DATE');
}

  getShops(companyName: string, isAdmin: boolean, dateFrom?: string, dateTo?: string) {
    const data = (this.cache.get('shops') || []) as any[];
    return this.filterCompany(data, companyName, isAdmin);
  }

  getProducts(companyName: string, isAdmin: boolean, dateFrom?: string, dateTo?: string) {
    const data = (this.cache.get('products') || []) as any[];
    return this.filterCompany(data, companyName, isAdmin);
  }

  // Date-aware, cross-platform-merged Top Products (#6). Tenants are always pinned
  // to their own company (the `company` arg is ignored for them); admins may scope
  // to a company or pass 'all'/none for a cross-company ranking. Results are cached
  // per full param set; admin all-company scans run serialized (heavy) like the
  // other admin loads.
  async getProductsRanked(
    companyName: string, isAdmin: boolean,
    opts: { dateFrom?: string; dateTo?: string; platform?: string; account?: string; company?: string; brand?: string; category?: string; all?: boolean },
  ): Promise<any[]> {
    const from = opts.dateFrom || '2023-01-01';
    const to   = opts.dateTo   || new Date().toISOString().slice(0, 10);
    const effCompany = isAdmin
      ? (opts.company && opts.company !== 'all' ? opts.company : null)
      : companyName;
    const platform = opts.platform && opts.platform !== 'all' ? opts.platform : null;
    const account  = opts.account  && opts.account  !== 'all' ? opts.account  : null;
    const brand    = opts.brand    && opts.brand    !== 'all' ? opts.brand    : undefined;
    const category = opts.category && opts.category !== 'all' ? opts.category : undefined;
    const cap = opts.all ? 1000 : 50;  // "all assortment" view lifts the Top-50 cap
    const key = JSON.stringify({ c: effCompany ?? '*', from, to, p: platform ?? '*', a: account ?? '*', b: brand ?? '*', cat: category ?? '*', cap });
    const run = () => this.fetchProductsRanked(from, to, effCompany, platform, account, brand, category, cap);
    const fetchFn = (isAdmin && !effCompany) ? () => this.runExclusive(run) : run;
    return this.loadWithCache(
      this.productsRankedCache, this.productsRankedInflight, key, fetchFn, 'products-ranked',
    );
  }

  // Distinct brands & categories available to the caller, for the filter dropdowns.
  // Dynamic/cascading: the lists reflect the active company + account + platform
  // selection, and Brand ↔ Category narrow each other (the Category list is
  // computed under the selected brand, and vice-versa) so the dropdowns only ever
  // offer combinations that exist in the catalog. Catalog-based (DIM_PRODUCTS), not
  // sales-based, so it stays instant and date-independent.
  getProductDims(
    companyName: string, isAdmin: boolean,
    opts: { company?: string; account?: string; platform?: string; brand?: string; category?: string } = {},
  ) {
    const rows = (this.cache.get('productDims') || []) as any[];
    const effCompany = isAdmin ? (opts.company && opts.company !== 'all' ? opts.company : null) : companyName;
    const account  = opts.account  && opts.account  !== 'all' ? opts.account  : null;
    const platform = opts.platform && opts.platform !== 'all' ? opts.platform : null;
    const brand    = opts.brand    && opts.brand    !== 'all' ? opts.brand    : null;
    const category = opts.category && opts.category !== 'all' ? opts.category : null;
    // Common scope (company/account/platform) shared by both dropdowns.
    const base = rows.filter(r =>
      (!effCompany || r.COMPANY_NAME === effCompany) &&
      (!account    || r.ACCOUNT_NAME === account) &&
      (!platform   || r.PLATFORM === platform));
    const uniqSort = (vals: any[]) => [...new Set(vals.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
    // Brand list respects the selected category; category list respects the selected
    // brand — so picking one narrows the other without locking it.
    const brands = uniqSort(base.filter(r => !category || r.PRODUCT_CATEGORY === category).map(r => r.BRAND_NAME));
    const categories = uniqSort(base.filter(r => !brand || r.BRAND_NAME === brand).map(r => r.PRODUCT_CATEGORY));
    return { brands, categories };
  }

  async getPersonas(companyName: string, isAdmin: boolean, period = PERSONA_DEFAULT_PERIOD, brand?: string, category?: string) {
    // Unknown/absent period falls back to the default window.
    const per = PERSONA_PERIODS[period] ? period : PERSONA_DEFAULT_PERIOD;
    if (this.brandCatActive(brand, category)) {
      // On-demand RFM recompute restricted to the brand/category (heavy → serialized
      // and cached per period+brand+category). Segments under the ≥500-buyer gate
      // drop out, so narrow filters may yield few/no tiers.
      const { sql, binds } = this.personaQueryEnriched(PERSONA_PERIODS[per], brand, category);
      const key = `${per}|${brand || 'all'}|${category || 'all'}`;
      const data = await this.loadWithCache(
        this.personasBCCache, this.personasBCInflight,
        key, () => this.runExclusive(() => this.snowflake.query(sql, binds)), 'personas-bc',
      );
      return this.filterCompany(data, companyName, isAdmin);
    }
    const data = (this.cache.get(`personas:${per}`) || []) as any[];
    return this.filterCompany(data, companyName, isAdmin);
  }

  getAccounts() {
    return this.cache.get('accounts') || [];
  }

  async getGeo(companyName: string, isAdmin: boolean, period = GEO_DEFAULT_PERIOD, brand?: string, category?: string) {
  const per = GEO_PERIODS[period] ? period : GEO_DEFAULT_PERIOD;
  if (this.brandCatActive(brand, category)) {
    const floor = GEO_PERIODS[per];
    const key = `${companyName}|${per}|${brand || 'all'}|${category || 'all'}`;
    const data = isAdmin
      ? await this.runExclusive(() => this.fetchGeoEnriched(null, floor, brand, category))
      : await this.loadWithCache(
          this.geoBCCache, this.geoBCInflight,
          key, () => this.fetchGeoEnriched(companyName, floor, brand, category), 'geo-bc',
        );
    return this.filterCompany(data, companyName, isAdmin);
  }
  const data = (this.cache.get(`geo:${per}`) || []) as any[];
  return this.filterCompany(data, companyName, isAdmin);
}

async getDiscounts(companyName: string, isAdmin: boolean, dateFrom?: string, dateTo?: string, brand?: string, category?: string) {
  let data: any[];
  if (this.brandCatActive(brand, category)) {
    const key = `${companyName}|${brand || 'all'}|${category || 'all'}`;
    data = isAdmin
      ? await this.runExclusive(() => this.fetchDiscountsEnriched(null, brand, category))
      : await this.loadWithCache(
          this.discountsBCByCompany, this.discountsBCInflight,
          key, () => this.fetchDiscountsEnriched(companyName, brand, category), 'discounts-bc',
        );
  } else {
    data = isAdmin
      ? await this.runExclusive(() => this.fetchAllDiscounts()) // all tenants, serialized, uncached
      : await this.loadWithCache(
          this.discountsByCompany, this.discountsInflight,
          companyName, c => this.fetchTenantDiscounts(c), 'discounts',
        );
  }
  return this.filterAndDate(data, companyName, isAdmin, dateFrom, dateTo, 'ORDER_DATE');
}

getDoi(companyName: string, isAdmin: boolean) {
    const data = (this.cache.get('doi') || []) as any[];
    if (isAdmin) return data;
    // Standard tenant isolation by COMPANY_NAME (rows tagged in refreshDoi via the
    // OP_CHN_MAP_V2 crosswalk). Shared/unresolved CUST_IDs have COMPANY_NAME = null.
    return data.filter(r => r.COMPANY_NAME === companyName);
  }

  // Cancellation / return counts — date-filterable, same tenant model as KPIs.
  // Brand/category-aware on demand (DIM_PRODUCTS join), else the eager cache.
  async getCancellations(companyName: string, isAdmin: boolean, dateFrom?: string, dateTo?: string, brand?: string, category?: string) {
    if (this.brandCatActive(brand, category)) {
      const key = `${companyName}|${brand || 'all'}|${category || 'all'}`;
      const data = isAdmin
        ? await this.runExclusive(() => this.fetchCancellationsEnriched(null, brand, category))
        : await this.loadWithCache(
            this.cancellationsBCByCompany, this.cancellationsBCInflight,
            key, () => this.fetchCancellationsEnriched(companyName, brand, category), 'cancellations-bc',
          );
      return this.filterAndDate(data, companyName, isAdmin, dateFrom, dateTo, 'ORDER_DATE');
    }
    const data = (this.cache.get('cancellations') || []) as any[];
    return this.filterAndDate(data, companyName, isAdmin, dateFrom, dateTo, 'ORDER_DATE');
  }

  // Repeat-purchase metrics (trailing 12 mo). Rows are pre-aggregated per
  // (company, platform) with RETENTION_ALL rollup rows. Tenants get only their
  // own company's rows (incl. their all-platform rollup); admins get everything
  // including the global RETENTION_ALL rows. The frontend selects the row that
  // matches the active company/platform filter.
  getRetention(companyName: string, isAdmin: boolean) {
    const data = (this.cache.get('retention') || []) as any[];
    return this.filterCompany(data, companyName, isAdmin);
  }

  // Brand/category-aware repeat purchase for the active (company, account, platform)
  // scope, computed on demand. Returns a single aggregated row. Tenants are pinned
  // to their own company; admins may scope to one company or across all.
  async getRetentionFiltered(
    companyName: string, isAdmin: boolean,
    opts: { account?: string; platform?: string; brand?: string; category?: string; company?: string },
  ) {
    const effCompany = isAdmin ? (opts.company && opts.company !== 'all' ? opts.company : null) : companyName;
    const account  = opts.account  && opts.account  !== 'all' ? opts.account  : null;
    const platform = opts.platform && opts.platform !== 'all' ? opts.platform : null;
    const brand    = opts.brand    && opts.brand    !== 'all' ? opts.brand    : undefined;
    const category = opts.category && opts.category !== 'all' ? opts.category : undefined;
    const key = JSON.stringify({ c: effCompany ?? '*', a: account ?? '*', p: platform ?? '*', b: brand ?? '*', cat: category ?? '*' });
    const run = () => this.fetchRetentionFiltered(effCompany, account, platform, brand, category);
    const fetchFn = (isAdmin && !effCompany) ? () => this.runExclusive(run) : run;
    const rows = await this.loadWithCache(this.retentionBCCache, this.retentionBCInflight, key, fetchFn, 'retention-bc');
    return rows[0] || { BUYERS: 0, REPEAT_BUYERS: 0, REPEAT_RATE: 0, REPEAT_GMV_SHARE: 0, AVG_ORDERS: 0 };
  }

  // New vs existing buyers for the active scope + date range, computed on demand.
  // Returns one aggregated row. Tenants are pinned to their own company; admins may
  // scope to one company or across all (the all-company scan is serialized).
  async getNewVsExisting(
    companyName: string, isAdmin: boolean,
    opts: { dateFrom?: string; dateTo?: string; account?: string; platform?: string; brand?: string; category?: string; company?: string },
  ) {
    const from = opts.dateFrom || '2023-01-01';
    const to   = opts.dateTo   || new Date().toISOString().slice(0, 10);
    const effCompany = isAdmin ? (opts.company && opts.company !== 'all' ? opts.company : null) : companyName;
    const account  = opts.account  && opts.account  !== 'all' ? opts.account  : null;
    const platform = opts.platform && opts.platform !== 'all' ? opts.platform : null;
    const brand    = opts.brand    && opts.brand    !== 'all' ? opts.brand    : undefined;
    const category = opts.category && opts.category !== 'all' ? opts.category : undefined;
    const key = JSON.stringify({ c: effCompany ?? '*', from, to, a: account ?? '*', p: platform ?? '*', b: brand ?? '*', cat: category ?? '*' });
    const run = () => this.fetchNewVsExisting(effCompany, account, platform, from, to, brand, category);
    const fetchFn = (isAdmin && !effCompany) ? () => this.runExclusive(run) : run;
    const rows = await this.loadWithCache(this.newVsExistingCache, this.newVsExistingInflight, key, fetchFn, 'new-vs-existing');
    return rows[0] || { BUYERS: 0, NEW_BUYERS: 0, EXISTING_BUYERS: 0, NEW_RATE: 0, EXISTING_RATE: 0 };
  }

  getStatus() {
    return {
      lastRefreshed: this.lastRefreshed,
      keys: Array.from(this.cache.keys()),
      counts: Object.fromEntries(
        Array.from(this.cache.entries()).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])
      ),
      lazy: {
        timeseries: this.timeseriesByCompany.size,
        discounts: this.discountsByCompany.size,
      },
    };
  }

  private filterCompany(data: any[], companyName: string, isAdmin: boolean) {
    if (isAdmin) return data;
    return data.filter(r => r.COMPANY_NAME === companyName);
  }

  private filterAndDate(
  data: any[], companyName: string, isAdmin: boolean,
  dateFrom?: string, dateTo?: string, dateField = 'ORDER_DATE'
) {
  return data.filter(r => {
    const compMatch = isAdmin || r.COMPANY_NAME === companyName;
    const raw = r[dateField];
    // Handle both JS Date objects and string dates from Snowflake
    let dateStr: string;
    if (raw instanceof Date) {
      dateStr = raw.toISOString().slice(0, 10);
    } else {
      dateStr = String(raw).slice(0, 10);
    }
    const fromMatch = !dateFrom || dateStr >= dateFrom;
    const toMatch   = !dateTo   || dateStr <= dateTo;
    return compMatch && fromMatch && toMatch;
  });
}
}