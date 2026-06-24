import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SnowflakeService } from '../snowflake/snowflake.service';
import * as cron from 'node-cron';

@Injectable()
export class CacheService implements OnModuleInit {
  private readonly logger = new Logger(CacheService.name);
  private cache: Map<string, any> = new Map();
  private lastRefreshed: Date | null = null;

  constructor(private snowflake: SnowflakeService) {}

  async onModuleInit() {
    this.logger.log('Populating cache on startup...');
    await this.refreshAll();

    // Schedule nightly refresh at midnight PHT (UTC+8) = 16:00 UTC
    cron.schedule('0 16 * * *', async () => {
      this.logger.log('Running scheduled midnight PHT cache refresh...');
      await this.refreshAll();
    });
  }

  private async refreshAll() {
    try {
      await Promise.all([
        this.refreshKpis(),
        this.refreshTimeSeries(),
        this.refreshShops(),
        this.refreshProducts(),
        this.refreshAccounts(),
        this.refreshGeo(),
        this.refreshDiscounts(),
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

  private async refreshTimeSeries() {
    const data = await this.snowflake.query(`
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
    this.cache.set('timeseries', data);
    this.logger.log(`Time series cached — ${data.length} rows`);
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

private async refreshDiscounts() {
  const data = await this.snowflake.query(`
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
  this.cache.set('discounts', data);
  this.logger.log(`Discounts cached — ${data.length} rows`);
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

  // ── PUBLIC GETTERS ──────────────────────────────────────────────

 getKpis(companyName: string, isAdmin: boolean, dateFrom?: string, dateTo?: string) {
    const data = (this.cache.get('kpis') || []) as any[];
    return this.filterCompany(data, companyName, isAdmin);
  }

  getTimeSeries(companyName: string, isAdmin: boolean, dateFrom?: string, dateTo?: string) {
  const data = (this.cache.get('timeseries') || []) as any[];
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

getDiscounts(companyName: string, isAdmin: boolean, dateFrom?: string, dateTo?: string) {
  const data = (this.cache.get('discounts') || []) as any[];
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