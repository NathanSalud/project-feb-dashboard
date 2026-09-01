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

// Onboarding floor: never show a marketplace account's orders from before it was
// onboarded (DIM_MARKETPLACE_ACCOUNTS.ONBOARD_DATE) — that pre-onboarding data is
// spurious and, e.g., fragments the trend lines. Appended to every FACT↔DIM join
// below (f = fact, a = accounts dim). Accounts with a NULL onboard date are left
// unfiltered so they behave exactly as before.
const ONBOARD_FLOOR_SQL = '(a.ONBOARD_DATE IS NULL OR f.ORDER_DATE >= a.ONBOARD_DATE)';

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
          NTILE(10) OVER (PARTITION BY COMPANY_NAME, PLATFORM ORDER BY orders ASC)          AS freq_score,
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

  // Pure Snowflake fetchers for time series — no caching here (policy lives in
  // loadWithCache / the getter). SQL copied verbatim from the old
  // refreshTimeSeries; tenant variant adds ONLY `AND a.COMPANY_NAME = ?`.
  private fetchAllTimeSeries(): Promise<any[]> {
    return this.snowflake.query(`
      SELECT
        a.COMPANY_NAME,
        a.ACCOUNT_NAME,
        a.PLATFORM,
        DATE_TRUNC('DAY', f.ORDER_DATE)         AS ORDER_DATE,
        COUNT(DISTINCT f.PLATFORM_ORDER_ID)     AS ORDERS,
        COUNT(f.ORDER_ITEM_SK)                  AS ITEMS,
        ROUND(SUM(f.ORIGINAL_PRODUCT_PRICE), 2) AS REVENUE,
        ROUND(SUM(f.PLATFORM_DISCOUNT), 2)              AS PLATFORM_DISCOUNT,
        ROUND(SUM(f.SELLER_DISCOUNT), 2)                AS SELLER_DISCOUNT,
        ROUND(SUM(f.PLATFORM_SHIPPING_FEE_DISCOUNT), 2) AS SHIPPING_DISCOUNT
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

  private fetchTenantTimeSeries(companyName: string): Promise<any[]> {
    return this.snowflake.query(`
      SELECT
        a.COMPANY_NAME,
        a.ACCOUNT_NAME,
        a.PLATFORM,
        DATE_TRUNC('DAY', f.ORDER_DATE)         AS ORDER_DATE,
        COUNT(DISTINCT f.PLATFORM_ORDER_ID)     AS ORDERS,
        COUNT(f.ORDER_ITEM_SK)                  AS ITEMS,
        ROUND(SUM(f.ORIGINAL_PRODUCT_PRICE), 2) AS REVENUE,
        ROUND(SUM(f.PLATFORM_DISCOUNT), 2)              AS PLATFORM_DISCOUNT,
        ROUND(SUM(f.SELLER_DISCOUNT), 2)                AS SELLER_DISCOUNT,
        ROUND(SUM(f.PLATFORM_SHIPPING_FEE_DISCOUNT), 2) AS SHIPPING_DISCOUNT
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
      // Normalise province names and merge duplicates
      const merged: Record<string, any> = {};
      data.forEach((r: any) => {
        const province = this.normaliseProvince(r.SHIPPING_PROVINCE);
        const key = `${r.COMPANY_NAME}|${r.ACCOUNT_NAME}|${r.PLATFORM}|${province}`;
        if (!merged[key]) {
          merged[key] = {
            COMPANY_NAME:      r.COMPANY_NAME,
            ACCOUNT_NAME:      r.ACCOUNT_NAME,
            PLATFORM:          r.PLATFORM,
            SHIPPING_PROVINCE: province,
            ORDERS:            0,
            REVENUE:           0,
          };
        }
        merged[key].ORDERS  += Number(r.ORDERS);
        merged[key].REVENUE += Number(r.REVENUE);
      });
      const result = Object.values(merged);
      this.cache.set(`geo:${period}`, result);
      this.logger.log(`Geo[${period}] cached — ${result.length} rows`);
    } catch (err) {
      this.cache.set(`geo:${period}`, []);
      this.logger.warn(`Geo[${period}] refresh skipped: ${(err as Error).message}`);
    }
  });
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
    this.logger.log('Lazy per-tenant caches cleared (timeseries, discounts)');
  }

  // ── PUBLIC GETTERS ──────────────────────────────────────────────

 getKpis(companyName: string, isAdmin: boolean, dateFrom?: string, dateTo?: string) {
    const data = (this.cache.get('kpis') || []) as any[];
    return this.filterCompany(data, companyName, isAdmin);
  }

  async getTimeSeries(companyName: string, isAdmin: boolean, dateFrom?: string, dateTo?: string) {
  const data = isAdmin
    ? await this.runExclusive(() => this.fetchAllTimeSeries()) // all tenants, serialized, uncached
    : await this.loadWithCache(
        this.timeseriesByCompany, this.timeseriesInflight,
        companyName, c => this.fetchTenantTimeSeries(c), 'timeseries',
      );
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

  getPersonas(companyName: string, isAdmin: boolean, period = PERSONA_DEFAULT_PERIOD) {
    // Unknown/absent period falls back to the default window.
    const key = PERSONA_PERIODS[period] ? `personas:${period}` : `personas:${PERSONA_DEFAULT_PERIOD}`;
    const data = (this.cache.get(key) || []) as any[];
    return this.filterCompany(data, companyName, isAdmin);
  }

  getAccounts() {
    return this.cache.get('accounts') || [];
  }

  getGeo(companyName: string, isAdmin: boolean, period = GEO_DEFAULT_PERIOD) {
  const key = GEO_PERIODS[period] ? `geo:${period}` : `geo:${GEO_DEFAULT_PERIOD}`;
  const data = (this.cache.get(key) || []) as any[];
  return this.filterCompany(data, companyName, isAdmin);
}

async getDiscounts(companyName: string, isAdmin: boolean, dateFrom?: string, dateTo?: string) {
  const data = isAdmin
    ? await this.runExclusive(() => this.fetchAllDiscounts()) // all tenants, serialized, uncached
    : await this.loadWithCache(
        this.discountsByCompany, this.discountsInflight,
        companyName, c => this.fetchTenantDiscounts(c), 'discounts',
      );
  return this.filterAndDate(data, companyName, isAdmin, dateFrom, dateTo, 'ORDER_DATE');
}

getDoi(companyName: string, isAdmin: boolean) {
    const data = (this.cache.get('doi') || []) as any[];
    if (isAdmin) return data;
    // Standard tenant isolation by COMPANY_NAME (rows tagged in refreshDoi via the
    // OP_CHN_MAP_V2 crosswalk). Shared/unresolved CUST_IDs have COMPANY_NAME = null.
    return data.filter(r => r.COMPANY_NAME === companyName);
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