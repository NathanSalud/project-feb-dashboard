import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as snowflake from 'snowflake-sdk';

@Injectable()
export class SnowflakeService implements OnModuleInit {
  private readonly logger = new Logger(SnowflakeService.name);
  private connection!: snowflake.Connection;

  constructor(private config: ConfigService) {}

  async onModuleInit() {
    await this.connect();
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.connection = snowflake.createConnection({
        account:   this.config.get<string>('SNOWFLAKE_ACCOUNT'),
        username:  this.config.get<string>('SNOWFLAKE_USERNAME'),
        password:  this.config.get<string>('SNOWFLAKE_PASSWORD'),
        database:  this.config.get<string>('SNOWFLAKE_DATABASE'),
        schema:    this.config.get<string>('SNOWFLAKE_SCHEMA'),
        warehouse: this.config.get<string>('SNOWFLAKE_WAREHOUSE'),
        role:      this.config.get<string>('SNOWFLAKE_ROLE'),
      });

      this.connection.connect((err) => {
        if (err) {
          this.logger.error('Snowflake connection failed', err.message);
          reject(err);
        } else {
          this.logger.log('Snowflake connected successfully');
          resolve();
        }
      });
    });
  }

  query<T = any>(sql: string, binds: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.connection.execute({
        sqlText: sql,
        binds,
        complete: (err, _stmt, rows) => {
          if (err) {
            this.logger.error('Query failed', err.message);
            reject(err);
          } else {
            resolve(rows as T[]);
          }
        },
      });
    });
  }
}
