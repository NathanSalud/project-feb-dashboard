import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SnowflakeModule } from './snowflake/snowflake.module';
import { AuthModule } from './auth/auth.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { CacheModule } from './cache/cache.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SnowflakeModule,
    AuthModule,
    CacheModule,
    DashboardModule,
  ],
})
export class AppModule {}