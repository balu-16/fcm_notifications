import {
  Global,
  Inject,
  Injectable,
  Module,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  Pool,
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from 'pg';
import { APP_CONFIG, type AppConfig } from '../config/config.module.js';

@Injectable()
export class Database implements OnModuleDestroy {
  readonly pool: Pool;
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
    this.pool.on('error', () =>
      console.error(
        JSON.stringify({
          level: 'error',
          message: 'Idle PostgreSQL connection failed',
        }),
      ),
    );
  }
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    parameters: unknown[] = [],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(sql, parameters);
  }
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
@Global()
@Module({ providers: [Database], exports: [Database] })
export class DatabaseModule {}
