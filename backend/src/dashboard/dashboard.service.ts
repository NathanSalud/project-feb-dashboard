import { Injectable } from '@nestjs/common';
import { SnowflakeService } from '../snowflake/snowflake.service';

@Injectable()
export class DashboardService {
  constructor(private snowflake: SnowflakeService) {}

  private baseWhere(companyName: string, isAdmin: boolean, dateFrom?: string, dateTo?: string): string {
    const company = isAdmin ? '' : `AND a.COMPANY_NAME = '${companyName}'`;
    const from = dateFrom ? `AND f.ORDER_DATE >= '${dateFrom}'` : `AND f.ORDER_DATE >= '2023-01-01'`;
    const to   = dateTo   ? `AND f.ORDER_DATE <= '${dateTo}'`   : '';
    return `
      f.ITEM_STATUS IN ('Completed','Shipped','Delivered','Ready to Ship')
      AND a.IS_ACTIVE = TRUE
      AND a.ACCOUNT_NAME != 's'
      ${company}
      ${from}
      ${to}
    `;
  }

  async getKpis(companyName: string, isAdmin: boolean, dateFrom?: string, dateTo?: string) {
    return this.snowflake.query(`
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
      WHERE ${this.baseWhere(companyName, isAdmin, dateFrom, dateTo)}
      GROUP BY a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM
      ORDER BY a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM
    `);
  }

  async getTimeSeries(companyName: string, isAdmin: boolean, dateFrom?: string, dateTo?: string) {
    return this.snowflake.query(`
      SELECT
        a.COMPANY_NAME,
        a.ACCOUNT_NAME,
        a.PLATFORM,
        DATE_TRUNC('MONTH', f.ORDER_DATE)       AS ORDER_MONTH,
        COUNT(DISTINCT f.PLATFORM_ORDER_ID)     AS ORDERS,
        ROUND(SUM(f.ORIGINAL_PRODUCT_PRICE), 2) AS REVENUE
      FROM GDEC_DATAMART.GOLD_SCHEMA.FACT_PLATFORM_ORDER_ITEMS f
      INNER JOIN GDEC_DATAMART.GOLD_SCHEMA.DIM_MARKETPLACE_ACCOUNTS a ON f.SHOP_ID = a.SHOP_ID
      WHERE ${this.baseWhere(companyName, isAdmin, dateFrom, dateTo)}
      GROUP BY a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM, DATE_TRUNC('MONTH', f.ORDER_DATE)
      ORDER BY a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM, ORDER_MONTH
    `);
  }

  async getShops(companyName: string, isAdmin: boolean, dateFrom?: string, dateTo?: string) {
    return this.snowflake.query(`
      SELECT
        a.COMPANY_NAME,
        a.ACCOUNT_NAME,
        a.PLATFORM,
        a.SHOP_ID,
        a.SHOP_NAME,
        COUNT(DISTINCT f.PLATFORM_ORDER_ID)                                    AS ORDERS,
        COUNT(f.ORDER_ITEM_SK)                                                 AS ITEMS,
        ROUND(SUM(f.ORIGINAL_PRODUCT_PRICE), 2)                               AS REVENUE,
        ROUND(SUM(f.ORIGINAL_PRODUCT_PRICE) / NULLIF(COUNT(DISTINCT f.PLATFORM_ORDER_ID), 0), 2) AS AOV
      FROM GDEC_DATAMART.GOLD_SCHEMA.FACT_PLATFORM_ORDER_ITEMS f
      INNER JOIN GDEC_DATAMART.GOLD_SCHEMA.DIM_MARKETPLACE_ACCOUNTS a ON f.SHOP_ID = a.SHOP_ID
      WHERE ${this.baseWhere(companyName, isAdmin, dateFrom, dateTo)}
      GROUP BY a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM, a.SHOP_ID, a.SHOP_NAME
      ORDER BY a.COMPANY_NAME, REVENUE DESC
    `);
  }

  async getProducts(companyName: string, isAdmin: boolean, dateFrom?: string, dateTo?: string) {
    return this.snowflake.query(`
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
      WHERE ${this.baseWhere(companyName, isAdmin, dateFrom, dateTo)}
      GROUP BY a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM, f.PRODUCT_NAME
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM
        ORDER BY SUM(f.ORIGINAL_PRODUCT_PRICE) DESC
      ) <= 10
      ORDER BY a.COMPANY_NAME, a.ACCOUNT_NAME, a.PLATFORM, REVENUE DESC
    `);
  }

  async getAccounts() {
    return this.snowflake.query(`
      SELECT DISTINCT
        COMPANY_NAME, ACCOUNT_NAME, PLATFORM,
        SHOP_ID, SHOP_NAME, IS_ACTIVE,
        ACCOUNT_CATEGORY, BUSINESS_MODEL
      FROM GDEC_DATAMART.GOLD_SCHEMA.DIM_MARKETPLACE_ACCOUNTS
      WHERE IS_ACTIVE = TRUE AND ACCOUNT_NAME != 's'
      ORDER BY COMPANY_NAME, ACCOUNT_NAME, PLATFORM
    `);
  }
}