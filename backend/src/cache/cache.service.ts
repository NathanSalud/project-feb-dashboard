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