import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { InsightsService } from './insights.service';
import { JwtGuard } from '../auth/jwt/jwt.guard';

@Controller('insights')
@UseGuards(JwtGuard)
export class InsightsController {
  constructor(private insightsService: InsightsService) {}

  @Post('generate')
  generate(@Body() body: any) {
    return this.insightsService.generateInsights(body);
  }
}