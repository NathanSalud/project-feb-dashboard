import { Controller, Get, UseGuards, Request, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtGuard } from '../auth/jwt/jwt.guard';

@Controller('dashboard')
@UseGuards(JwtGuard)
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get('kpis')
  getKpis(
    @Request() req,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.dashboardService.getKpis(req.user.companyName, req.user.isAdmin, dateFrom, dateTo);
  }

  @Get('timeseries')
  getTimeSeries(
    @Request() req,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('brand') brand?: string,
    @Query('category') category?: string,
  ) {
    return this.dashboardService.getTimeSeries(req.user.companyName, req.user.isAdmin, dateFrom, dateTo, brand, category);
  }

  @Get('shops')
  getShops(
    @Request() req,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.dashboardService.getShops(
      req.user.companyName, req.user.isAdmin, dateFrom, dateTo,
      limit ? parseInt(limit) : undefined,
      offset ? parseInt(offset) : undefined,
    );
  }

  @Get('products')
  getProducts(
    @Request() req,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.dashboardService.getProducts(
      req.user.companyName, req.user.isAdmin, dateFrom, dateTo,
      limit ? parseInt(limit) : undefined,
      offset ? parseInt(offset) : undefined,
    );
  }

  // Date-aware, cross-platform-merged Top Products (#6). Server-side filters mirror
  // the dashboard selectors so the table always matches the scorecards' date range.
  @Get('products-ranked')
  getProductsRanked(
    @Request() req,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('platform') platform?: string,
    @Query('account') account?: string,
    @Query('company') company?: string,
    @Query('brand') brand?: string,
    @Query('category') category?: string,
  ) {
    return this.dashboardService.getProductsRanked(req.user.companyName, req.user.isAdmin, {
      dateFrom, dateTo, platform, account, company, brand, category,
    });
  }

  // Brand & Category options for the filter dropdowns, scoped to the tenant.
  @Get('product-dims')
  getProductDims(@Request() req, @Query('company') company?: string) {
    return this.dashboardService.getProductDims(req.user.companyName, req.user.isAdmin, company);
  }

  @Get('accounts')
  getAccounts() {
    return this.dashboardService.getAccounts();
  }

  @Get('geo')
  getGeo(
    @Request() req,
    @Query('period') period?: string,
    @Query('brand') brand?: string,
    @Query('category') category?: string,
  ) {
    return this.dashboardService.getGeo(req.user.companyName, req.user.isAdmin, period, brand, category);
  }

  @Get('discounts')
  getDiscounts(
    @Request() req,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('brand') brand?: string,
    @Query('category') category?: string,
  ) {
    return this.dashboardService.getDiscounts(req.user.companyName, req.user.isAdmin, dateFrom, dateTo, brand, category);
  }

  @Get('status')
  getStatus() {
    return this.dashboardService.getStatus();
  }

  @Get('doi')
  getDoi(@Request() req) {
    return this.dashboardService.getDoi(
      req.user.companyName,
      req.user.isAdmin,
    );
  }

  @Get('personas')
  getPersonas(
    @Request() req,
    @Query('period') period?: string,
    @Query('brand') brand?: string,
    @Query('category') category?: string,
  ) {
    return this.dashboardService.getPersonas(
      req.user.companyName,
      req.user.isAdmin,
      period,
      brand,
      category,
    );
  }

  @Get('cancellations')
  getCancellations(
    @Request() req,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('brand') brand?: string,
    @Query('category') category?: string,
  ) {
    return this.dashboardService.getCancellations(req.user.companyName, req.user.isAdmin, dateFrom, dateTo, brand, category);
  }

  @Get('retention')
  getRetention(@Request() req) {
    return this.dashboardService.getRetention(req.user.companyName, req.user.isAdmin);
  }

  // Brand/category-aware repeat purchase for the active scope (single aggregated row).
  @Get('retention-filtered')
  getRetentionFiltered(
    @Request() req,
    @Query('account') account?: string,
    @Query('platform') platform?: string,
    @Query('brand') brand?: string,
    @Query('category') category?: string,
    @Query('company') company?: string,
  ) {
    return this.dashboardService.getRetentionFiltered(req.user.companyName, req.user.isAdmin, {
      account, platform, brand, category, company,
    });
  }
}