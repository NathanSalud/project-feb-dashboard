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
  ) {
    return this.dashboardService.getTimeSeries(req.user.companyName, req.user.isAdmin, dateFrom, dateTo);
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

  @Get('accounts')
  getAccounts() {
    return this.dashboardService.getAccounts();
  }

  @Get('status')
  getStatus() {
    return this.dashboardService.getStatus();
  }
}