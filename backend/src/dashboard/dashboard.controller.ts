import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtGuard } from '../auth/jwt/jwt.guard';

@Controller('dashboard')
@UseGuards(JwtGuard)
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get('kpis')
  getKpis(@Request() req) {
    return this.dashboardService.getKpis(
      req.user.companyName,
      req.user.isAdmin,
    );
  }

  @Get('timeseries')
  getTimeSeries(@Request() req) {
    return this.dashboardService.getTimeSeries(
      req.user.companyName,
      req.user.isAdmin,
    );
  }

  @Get('shops')
  getShops(@Request() req) {
    return this.dashboardService.getShops(
      req.user.companyName,
      req.user.isAdmin,
    );
  }

  @Get('products')
  getProducts(@Request() req) {
    return this.dashboardService.getProducts(
      req.user.companyName,
      req.user.isAdmin,
    );
  }

  @Get('accounts')
  getAccounts() {
    return this.dashboardService.getAccounts();
  }
}