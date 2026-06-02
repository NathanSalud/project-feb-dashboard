import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { CacheModule } from '../cache/cache.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports:     [CacheModule, AuthModule],
  providers:   [DashboardService],
  controllers: [DashboardController],
})
export class DashboardModule {}