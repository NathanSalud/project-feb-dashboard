import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SnowflakeModule } from './snowflake/snowflake.module';
import { AuthModule } from './auth/auth.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { CacheModule } from './cache/cache.module';
import { InsightsModule } from './insights/insights.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SnowflakeModule,
    AuthModule,
    CacheModule,
    DashboardModule,
    InsightsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}