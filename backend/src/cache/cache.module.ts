import { Module } from '@nestjs/common';
import { CacheService } from './cache.service';
import { SnowflakeModule } from '../snowflake/snowflake.module';

@Module({
  imports:  [SnowflakeModule],
  providers: [CacheService],
  exports:   [CacheService],
})
export class CacheModule {}