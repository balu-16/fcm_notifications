import { Inject, Injectable } from '@nestjs/common';
import { Database } from '../database/database.module.js';
import type { DeviceDto } from './devices.dto.js';

@Injectable()
export class DevicesRepository {
  constructor(@Inject(Database) private readonly database: Database) {}
  async register(
    userId: string,
    dto: DeviceDto,
    userAgent?: string,
  ): Promise<void> {
    await this.database.transaction(async (client) => {
      // Serialize registrations for this user so the active-device cap holds under concurrency.
      await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [
        userId,
      ]);
      await client.query(
        `INSERT INTO device_tokens (user_id, token, platform, user_agent)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform,
           user_agent = EXCLUDED.user_agent, is_active = true, deactivated_reason = NULL,
           last_seen_at = now(), updated_at = now()`,
        [userId, dto.token, dto.platform, userAgent?.slice(0, 300) ?? null],
      );
      await client.query(
        `UPDATE device_tokens SET is_active = false, deactivated_reason = 'device_limit', updated_at = now()
         WHERE id IN (
           SELECT id FROM device_tokens WHERE user_id = $1 AND is_active
           ORDER BY last_seen_at DESC, created_at DESC, id DESC OFFSET 20
         )`,
        [userId],
      );
    });
  }
  async deactivate(userId: string, token: string): Promise<void> {
    await this.database.query(
      `UPDATE device_tokens SET is_active = false, deactivated_reason = 'user_disabled', updated_at = now()
       WHERE user_id = $1 AND token = $2 AND is_active`,
      [userId, token],
    );
  }
  async deactivateStale(): Promise<void> {
    await this.database.query(
      `UPDATE device_tokens SET is_active = false, deactivated_reason = 'stale', updated_at = now()
       WHERE is_active AND last_seen_at < now() - interval '60 days'`,
    );
  }
}
