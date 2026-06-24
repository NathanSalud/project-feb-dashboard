import { Injectable, BadRequestException } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';

@Injectable()
export class DashboardService {
  constructor(private cache: CacheService) {}

  private validateDates(dateFrom?: string, dateTo?: string) {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (dateFrom && !dateRegex.test(dateFrom))
      throw new BadRequestException(`Invalid dateFrom format. Expected YYYY-MM-DD, got: ${dateFrom}`);
    if (dateTo && !dateRegex.test(dateTo))
      throw new BadRequestException(`Invalid dateTo format. Expected YYYY-MM-DD, got: ${dateTo}`);
    if (dateFrom && dateTo && dateFrom > dateTo)
      throw new BadRequestException('dateFrom cannot be later than dateTo');
  }

  getKpis(companyName: string, isAdmin: boolean, dateFrom?: string, dateTo?: string) {
    this.validateDates(dateFrom, dateTo);
    return this.cache.getKpis(companyName, isAdmin, dateFrom, dateTo);
  }

  getTimeSeries(companyName: string, isAdmin: boolean, dateFrom?: string, dateTo?: string) {
    this.validateDates(dateFrom, dateTo);
    return this.cache.getTimeSeries(companyName, isAdmin, dateFrom, dateTo);
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

  getAccounts() {
    return this.cache.getAccounts();
  }

  getGeo(companyName: string, isAdmin: boolean, dateFrom?: string, dateTo?: string) {
  this.validateDates(dateFrom, dateTo);
  return this.cache.getGeo(companyName, isAdmin);
}

  getDiscounts(companyName: string, isAdmin: boolean, dateFrom?: string, dateTo?: string) {
    this.validateDates(dateFrom, dateTo);
    return this.cache.getDiscounts(companyName, isAdmin, dateFrom, dateTo);
  }

  getDoi(customerIds: string[], isAdmin: boolean) {
    return this.cache.getDoi(customerIds, isAdmin);
  }
  
  getStatus() {
    return this.cache.getStatus();
  }
}