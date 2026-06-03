import { Controller, Get } from '@nestjs/common';
import { CacheService } from './cache/cache.service';

@Controller()
export class AppController {
  constructor(private cache: CacheService) {}

  @Get('health')
  health() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      cache: this.cache.getStatus(),
    };
  }
}