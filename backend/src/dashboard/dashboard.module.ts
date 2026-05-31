import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { SnowflakeModule } from '../snowflake/snowflake.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports:     [SnowflakeModule, AuthModule],
  providers:   [DashboardService],
  controllers: [DashboardController],
})
export class DashboardModule {}
