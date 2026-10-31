import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Pool } from 'pg';
import { EnvService } from '../config/env.service.ts';

export const DB = Symbol('DB');
export const PG_POOL = Symbol('PG_POOL');

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [EnvService],
      useFactory: (envService: EnvService) =>
        new Pool({
          connectionString: envService.get('DATABASE_URL'),
          max: 10,
          connectionTimeoutMillis: 2000,
        }),
    },
    {
      provide: DB,
      inject: [PG_POOL],
      useFactory: (pool: Pool) =>
        drizzle({
          client: pool,
        }),
    },
  ],
  exports: [DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @InjectPinoLogger(DatabaseModule.name) private readonly logger: PinoLogger,
  ) {}

  async onApplicationShutdown(signal?: string) {
    this.logger.info(`received ${signal}; closing connection pool...`);

    try {
      await this.pool.end();
      this.logger.info('database pool closed cleanly.');
    } catch (error) {
      this.logger.error({ err: error }, 'error closing database pool');
    }
  }
}
