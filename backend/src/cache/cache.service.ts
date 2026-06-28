import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SnowflakeService } from '../snowflake/snowflake.service';
import * as cron from 'node-cron';

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

  constructor(private snowflake: SnowflakeService) {}

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
      FROM GDEC_DATAMART.GOLD_SCHEMA.FACT_PLATFORM_ORDER_ITEMS f
      INNER JOIN GDEC_DATAMART.GOLD_SCHEMA.DIM_MARKETPLACE_ACCOUNTS a ON f.SHOP_ID = a.SHOP_ID
      WHERE f.ITEM_STATUS IN ('Completed','Shipped','Delivered','Ready to Ship')
      AND f.ORDER_DATE >= '2023-01-01'
      AND a.IS_ACTIVE = TRUE
      AND a.ACCOUNT_NAME != 's'
      GROUP BY a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM
      ORDER BY a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM
    `);
    this.cache.set('kpis', data);
    this.logger.log(`KPIs cached — ${data.length} rows`);
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
        ROUND(SUM(f.ORIGINAL_PRODUCT_PRICE), 2) AS REVENUE
      FROM GDEC_DATAMART.GOLD_SCHEMA.FACT_PLATFORM_ORDER_ITEMS f
      INNER JOIN GDEC_DATAMART.GOLD_SCHEMA.DIM_MARKETPLACE_ACCOUNTS a ON f.SHOP_ID = a.SHOP_ID
      WHERE f.ITEM_STATUS IN ('Completed','Shipped','Delivered','Ready to Ship')
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
        ROUND(SUM(f.ORIGINAL_PRODUCT_PRICE), 2) AS REVENUE
      FROM GDEC_DATAMART.GOLD_SCHEMA.FACT_PLATFORM_ORDER_ITEMS f
      INNER JOIN GDEC_DATAMART.GOLD_SCHEMA.DIM_MARKETPLACE_ACCOUNTS a ON f.SHOP_ID = a.SHOP_ID
      WHERE f.ITEM_STATUS IN ('Completed','Shipped','Delivered','Ready to Ship')
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
      FROM GDEC_DATAMART.GOLD_SCHEMA.FACT_PLATFORM_ORDER_ITEMS f
      INNER JOIN GDEC_DATAMART.GOLD_SCHEMA.DIM_MARKETPLACE_ACCOUNTS a ON f.SHOP_ID = a.SHOP_ID
      WHERE f.ITEM_STATUS IN ('Completed','Shipped','Delivered','Ready to Ship')
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
      FROM GDEC_DATAMART.GOLD_SCHEMA.FACT_PLATFORM_ORDER_ITEMS f
      INNER JOIN GDEC_DATAMART.GOLD_SCHEMA.DIM_MARKETPLACE_ACCOUNTS a ON f.SHOP_ID = a.SHOP_ID
      WHERE f.ITEM_STATUS IN ('Completed','Shipped','Delivered','Ready to Ship')
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

private async refreshGeo() {
  const data = await this.snowflake.query(`
    SELECT
      a.COMPANY_NAME,
      a.ACCOUNT_NAME,
      a.PLATFORM,
      f.SHIPPING_PROVINCE,
      COUNT(DISTINCT f.PLATFORM_ORDER_ID)     AS ORDERS,
      ROUND(SUM(f.ORIGINAL_PRODUCT_PRICE), 2) AS REVENUE
    FROM GDEC_DATAMART.GOLD_SCHEMA.FACT_PLATFORM_ORDER_ITEMS f
    INNER JOIN GDEC_DATAMART.GOLD_SCHEMA.DIM_MARKETPLACE_ACCOUNTS a ON f.SHOP_ID = a.SHOP_ID
    WHERE f.ITEM_STATUS IN ('Completed','Shipped','Delivered','Ready to Ship')
    AND f.ORDER_DATE >= '2023-01-01'
    AND a.IS_ACTIVE = TRUE
    AND a.ACCOUNT_NAME != 's'
    AND f.SHIPPING_PROVINCE IS NOT NULL
    AND f.SHIPPING_PROVINCE != ''
    GROUP BY a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM, f.SHIPPING_PROVINCE
    ORDER BY a.COMPANY_NAME, REVENUE DESC
  `);

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
  this.cache.set('geo', result);
  this.logger.log(`Geo cached — ${result.length} rows`);
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
    FROM GDEC_DATAMART.GOLD_SCHEMA.FACT_PLATFORM_ORDER_ITEMS f
    INNER JOIN GDEC_DATAMART.GOLD_SCHEMA.DIM_MARKETPLACE_ACCOUNTS a ON f.SHOP_ID = a.SHOP_ID
    WHERE f.ITEM_STATUS IN ('Completed','Shipped','Delivered','Ready to Ship')
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
    FROM GDEC_DATAMART.GOLD_SCHEMA.FACT_PLATFORM_ORDER_ITEMS f
    INNER JOIN GDEC_DATAMART.GOLD_SCHEMA.DIM_MARKETPLACE_ACCOUNTS a ON f.SHOP_ID = a.SHOP_ID
    WHERE f.ITEM_STATUS IN ('Completed','Shipped','Delivered','Ready to Ship')
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
    this.cache.set('doi', data);
    this.logger.log(`DOI cached — ${data.length} rows`);
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

  getAccounts() {
    return this.cache.get('accounts') || [];
  }

  getGeo(companyName: string, isAdmin: boolean) {
  const data = (this.cache.get('geo') || []) as any[];
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

getDoi(customerIds: string[], isAdmin: boolean) {
    const data = (this.cache.get('doi') || []) as any[];
    if (isAdmin) return data;
    return data.filter(r => customerIds.includes(r.CUSTOMER_ID));
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