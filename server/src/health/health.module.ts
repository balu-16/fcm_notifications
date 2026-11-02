import {
  Controller,
  Get,
  Inject,
  Module,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Public } from '../auth/auth.decorators.js';
import { Database } from '../database/database.module.js';
@Controller()
class HealthController {
  constructor(@Inject(Database) private readonly database: Database) {}
  @Public()
  @Get('health')
  async health() {
    try {
      await this.database.query('SELECT 1');
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException('Database unavailable');
    }
  }
}
@Module({ controllers: [HealthController] })
export class HealthModule {}
