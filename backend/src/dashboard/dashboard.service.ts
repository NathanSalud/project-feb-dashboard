import { Injectable, BadRequestException } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';

@Injectable()
export class DashboardService {
  constructor(private cache: CacheService) {}

  private validateDates(dateFrom?: string, dateTo?: string) {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    const assertValidDate = (label: string, value?: string) => {
      if (!value) return;
      if (!dateRegex.test(value))
        throw new BadRequestException(`Invalid ${label} format. Expected YYYY-MM-DD, got: ${value}`);
      // Shape can be valid but the date impossible (e.g. 2023-13-45, 2023-02-30).
      // Round-trip through UTC and confirm no component rolled over.
      const [y, m, d] = value.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d)
        throw new BadRequestException(`Invalid ${label}: not a real calendar date: ${value}`);
    };
    assertValidDate('dateFrom', dateFrom);
    assertValidDate('dateTo', dateTo);
    if (dateFrom && dateTo && dateFrom > dateTo)
      throw new BadRequestException('dateFrom cannot be later than dateTo');
  }

  getKpis(companyName: string, isAdmin: boolean, dateFrom?: string, dateTo?: string) {
    this.validateDates(dateFrom, dateTo);
    return this.cache.getKpis(companyName, isAdmin, dateFrom, dateTo);
  }

  async getTimeSeries(companyName: string, isAdmin: boolean, dateFrom?: string, dateTo?: string, brand?: string, category?: string) {
    this.validateDates(dateFrom, dateTo); // runs before any Snowflake fetch
    return this.cache.getTimeSeries(companyName, isAdmin, dateFrom, dateTo, brand, category);
  }

  getShops(companyName: string, isAdmin: boolean, dateFrom?: string, dateTo?: string, limit?: number, offset?: number) {
    this.validateDates(dateFrom, dateTo);
    const data  = this.cache.getShops(companyName, isAdmin, dateFrom, dateTo);
    const total = data.length;
    const paginated = limit !== undefined
      ? data.slice(offset || 0, (offset || 0) + limit)
      : data;
    return { data: paginated, total, limit, offset: offset || 0 };
  }

  getProducts(companyName: string, isAdmin: boolean, dateFrom?: string, dateTo?: string, limit?: number, offset?: number) {
    this.validateDates(dateFrom, dateTo);
    const data  = this.cache.getProducts(companyName, isAdmin, dateFrom, dateTo);
    const total = data.length;
    const paginated = limit !== undefined
      ? data.slice(offset || 0, (offset || 0) + limit)
      : data;
    return { data: paginated, total, limit, offset: offset || 0 };
  }

  async getProductsRanked(
    companyName: string, isAdmin: boolean,
    opts: { dateFrom?: string; dateTo?: string; platform?: string; account?: string; company?: string; brand?: string; category?: string; all?: boolean },
  ) {
    this.validateDates(opts.dateFrom, opts.dateTo);
    return this.cache.getProductsRanked(companyName, isAdmin, opts);
  }

  getProductDims(
    companyName: string, isAdmin: boolean,
    opts: { company?: string; account?: string; platform?: string; brand?: string; category?: string },
  ) {
    return this.cache.getProductDims(companyName, isAdmin, opts);
  }

  getAccounts() {
    return this.cache.getAccounts();
  }

  getGeo(companyName: string, isAdmin: boolean, period?: string, brand?: string, category?: string) {
  return this.cache.getGeo(companyName, isAdmin, period, brand, category);
}

  async getDiscounts(companyName: string, isAdmin: boolean, dateFrom?: string, dateTo?: string, brand?: string, category?: string) {
    this.validateDates(dateFrom, dateTo); // runs before any Snowflake fetch
    return this.cache.getDiscounts(companyName, isAdmin, dateFrom, dateTo, brand, category);
  }

  getDoi(companyName: string, isAdmin: boolean) {
    return this.cache.getDoi(companyName, isAdmin);
  }

  getPersonas(companyName: string, isAdmin: boolean, period?: string, brand?: string, category?: string) {
    return this.cache.getPersonas(companyName, isAdmin, period, brand, category);
  }

  getCancellations(companyName: string, isAdmin: boolean, dateFrom?: string, dateTo?: string, brand?: string, category?: string) {
    this.validateDates(dateFrom, dateTo);
    return this.cache.getCancellations(companyName, isAdmin, dateFrom, dateTo, brand, category);
  }

  getRetention(companyName: string, isAdmin: boolean) {
    return this.cache.getRetention(companyName, isAdmin);
  }

  getRetentionFiltered(
    companyName: string, isAdmin: boolean,
    opts: { account?: string; platform?: string; brand?: string; category?: string; company?: string },
  ) {
    return this.cache.getRetentionFiltered(companyName, isAdmin, opts);
  }

  async getNewVsExisting(
    companyName: string, isAdmin: boolean,
    opts: { dateFrom?: string; dateTo?: string; account?: string; platform?: string; brand?: string; category?: string; company?: string },
  ) {
    this.validateDates(opts.dateFrom, opts.dateTo);
    return this.cache.getNewVsExisting(companyName, isAdmin, opts);
  }

  getStatus() {
    return this.cache.getStatus();
  }
}