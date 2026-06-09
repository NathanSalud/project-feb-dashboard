import { Module } from '@nestjs/common';
import { InsightsService } from './insights.service';
import { InsightsController } from './insights.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports:     [AuthModule],
  providers:   [InsightsService],
  controllers: [InsightsController],
})
export class InsightsModule {}