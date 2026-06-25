import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import knex, { Knex } from 'knex';

@Injectable()
export class KnexService implements OnModuleDestroy {
  private readonly logger = new Logger(KnexService.name);
  readonly knex: Knex;

  constructor(private config: ConfigService) {
    this.knex = knex({
      client: 'pg',
      connection: {
        host: this.config.get<string>('DB_HOST'),
        port: Number(this.config.get<string>('DB_PORT') ?? 5432),
        database: this.config.get<string>('DB_NAME'),
        user: this.config.get<string>('DB_USER'),
        password: this.config.get<string>('DB_PASSWORD'),
        ssl:
          this.config.get<string>('DB_SSL') === 'true'
            ? { rejectUnauthorized: false }
            : false,
      },
    });
  }

  async onModuleDestroy() {
    await this.knex.destroy();
    this.logger.log('Postgres connection pool closed');
  }
}
