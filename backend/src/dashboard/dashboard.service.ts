import { Injectable } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';

@Injectable()
export class DashboardService {
  constructor(private cache: CacheService) {}

  getKpis(companyName: string, isAdmin: boolean, dateFrom?: string, dateTo?: string) {
    return this.cache.getKpis(companyName, isAdmin, dateFrom, dateTo);
  }

  getTimeSeries(companyName: string, isAdmin: boolean, dateFrom?: string, dateTo?: string) {
    return this.cache.getTimeSeries(companyName, isAdmin, dateFrom, dateTo);
  }

  getShops(companyName: string, isAdmin: boolean, dateFrom?: string, dateTo?: string) {
    return this.cache.getShops(companyName, isAdmin, dateFrom, dateTo);
  }

  getProducts(companyName: string, isAdmin: boolean, dateFrom?: string, dateTo?: string) {
    return this.cache.getProducts(companyName, isAdmin, dateFrom, dateTo);
  }

  getAccounts() {
    return this.cache.getAccounts();
  }

  getStatus() {
    return this.cache.getStatus();
  }
}