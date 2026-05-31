import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SnowflakeModule } from './snowflake/snowflake.module';
import { AuthModule } from './auth/auth.module';
import { DashboardModule } from './dashboard/dashboard.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SnowflakeModule,
    AuthModule,
    DashboardModule,
  ],
})
export class AppModule {}