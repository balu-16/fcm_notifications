import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { Database } from '../database/database.module.js';
import type { Platform } from '../firebase/firebase.module.js';
import type { TargetDto } from './notifications.dto.js';
import type { NotificationPayload } from './validation.js';

interface Device {
  id: string;
  userId: string;
  platform: Platform;
}
interface TargetResolution {
  devices: Device[];
  totalUsers: number;
  skippedUsers: string[];
}
export interface CreatedNotification {
  id: string;
  status: string;
  totalDevices: number;
  skippedUsers: string[];
}
export interface DeliveryWork {
  id: string;
  deviceId: string | null;
  userId: string | null;
  platform: Platform;
  attempts: number;
}
export interface ActiveDelivery extends DeliveryWork {
  token: string;
}
export interface DeliveryUpdate {
  id: string;
  status: 'pending' | 'sent' | 'failed';
  messageId?: string;
  code?: string;
  message?: string;
  attempts: number;
}
interface StoredMessage {
  id: string;
  title: string;
  body: string;
  imageUrl: string | null;
  clickAction: string | null;
  data: Record<string, string>;
}

@Injectable()
export class NotificationsRepository {
  constructor(@Inject(Database) private readonly database: Database) {}

  private async target(
    client: PoolClient,
    target: TargetDto,
    lock: boolean,
  ): Promise<TargetResolution> {
    const requested = target.userIds ?? [];
    // Lock target users before device rows so concurrent registration uses the same lock order.
    const userQuery = lock
      ? `SELECT id FROM users WHERE ($1::text <> 'users' OR id = ANY($2::uuid[])) ORDER BY id FOR KEY SHARE`
      : `SELECT id FROM users WHERE ($1::text <> 'users' OR id = ANY($2::uuid[])) ORDER BY id`;
    const users = await client.query<{ id: string }>(userQuery, [
      target.type,
      requested,
    ]);
    if (target.type === 'users') {
      const found = new Set(users.rows.map((row) => row.id));
      const unknown = requested.filter((id) => !found.has(id));
      if (unknown.length)
        throw new UnprocessableEntityException(
          `Unknown user IDs: ${unknown.join(', ')}`,
        );
    }
    const ids = users.rows.map((row) => row.id);
    const parameters = [
      ids,
      target.type === 'platform' ? target.platform : null,
    ];
    const query = lock
      ? `SELECT id, user_id AS "userId", platform FROM device_tokens
         WHERE is_active AND user_id = ANY($1::uuid[]) AND ($2::text IS NULL OR platform = $2) ORDER BY id FOR UPDATE`
      : `SELECT id, user_id AS "userId", platform FROM device_tokens
         WHERE is_active AND user_id = ANY($1::uuid[]) AND ($2::text IS NULL OR platform = $2) ORDER BY id`;
    const devices = await client.query<Device>(query, parameters);
    const withDevices = new Set(devices.rows.map((device) => device.userId));
    return {
      devices: devices.rows,
      totalUsers: withDevices.size,
      skippedUsers: ids.filter((id) => !withDevices.has(id)),
    };
  }

  async preview(
    target: TargetDto,
  ): Promise<{
    totalDevices: number;
    totalUsers: number;
    skippedUsers: string[];
  }> {
    return this.database.transaction(async (client) => {
      const resolution = await this.target(client, target, false);
      return {
        totalDevices: resolution.devices.length,
        totalUsers: resolution.totalUsers,
        skippedUsers: resolution.skippedUsers,
      };
    });
  }

  async create(
    userId: string,
    key: string,
    target: TargetDto,
    payload: NotificationPayload,
  ): Promise<{ notification: CreatedNotification; replay: boolean }> {
    return this.database.transaction(async (client) => {
      // Serialize the same user's idempotency key before checking and inserting.
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`${userId}:${key}`],
      );
      const existing = await client.query<CreatedNotification>(
        `SELECT id, status, total_devices AS "totalDevices", skipped_user_ids AS "skippedUsers"
         FROM notifications WHERE created_by = $1 AND idempotency_key = $2`,
        [userId, key],
      );
      if (existing.rows[0])
        return { notification: existing.rows[0], replay: true };
      await client.query('SELECT id FROM users WHERE id = $1 FOR KEY SHARE', [
        userId,
      ]);
      const resolution = await this.target(client, target, true);
      if (!resolution.devices.length)
        throw new UnprocessableEntityException(
          'No active devices for this target',
        );
      const inserted = await client.query<CreatedNotification>(
        `INSERT INTO notifications
          (created_by, idempotency_key, title, body, image_url, click_action, data, target_type,
           target_user_ids, target_platform, skipped_user_ids, status, total_devices)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::uuid[], $10, $11::uuid[], 'pending', $12)
         RETURNING id, status, total_devices AS "totalDevices", skipped_user_ids AS "skippedUsers"`,
        [
          userId,
          key,
          payload.title,
          payload.body,
          payload.imageUrl ?? null,
          payload.clickAction ?? null,
          JSON.stringify(payload.data),
          target.type,
          target.userIds ?? null,
          target.platform ?? null,
          resolution.skippedUsers,
          resolution.devices.length,
        ],
      );
      const notification = inserted.rows[0];
      await client.query(
        `INSERT INTO notification_deliveries (notification_id, user_id, device_token_id, platform, status)
         SELECT $1, user_id, id, platform, 'pending' FROM device_tokens WHERE id = ANY($2::uuid[])`,
        [notification.id, resolution.devices.map((device) => device.id)],
      );
      return { notification, replay: false };
    });
  }

  async history(page: number, limit: number) {
    const [result, count] = await Promise.all([
      this.database.query(
        `SELECT n.id, n.title, n.target_type AS "targetType", n.target_platform AS "targetPlatform",
          n.status, n.total_devices AS "totalDevices", n.created_at AS "createdAt", u.email AS "creatorEmail",
          count(d.id) FILTER (WHERE d.status = 'sent')::int AS sent,
          count(d.id) FILTER (WHERE d.status = 'failed')::int AS failed,
          count(d.id) FILTER (WHERE d.status = 'pending')::int AS pending
         FROM notifications n JOIN users u ON u.id = n.created_by
         LEFT JOIN notification_deliveries d ON d.notification_id = n.id
         GROUP BY n.id, u.email ORDER BY n.created_at DESC, n.id DESC LIMIT $1 OFFSET $2`,
        [limit, (page - 1) * limit],
      ),
      this.database.query<{ total: number }>(
        'SELECT count(*)::int AS total FROM notifications',
      ),
    ]);
    return { items: result.rows, total: count.rows[0].total, page, limit };
  }

  async detail(id: string) {
    const notification = await this.database.query(
      `SELECT n.id, n.title, n.body, n.image_url AS "imageUrl", n.click_action AS "clickAction", n.data,
       n.target_type AS "targetType", n.target_user_ids AS "targetUserIds", n.target_platform AS "targetPlatform",
       n.skipped_user_ids AS "skippedUsers", n.status, n.total_devices AS "totalDevices", n.failure_reason AS "failureReason",
       n.created_at AS "createdAt", n.started_at AS "startedAt", n.completed_at AS "completedAt", u.email AS "creatorEmail"
       FROM notifications n JOIN users u ON u.id = n.created_by WHERE n.id = $1`,
      [id],
    );
    if (!notification.rows[0])
      throw new NotFoundException('Notification not found');
    const deliveries = await this.database.query(
      `SELECT d.id, u.email, d.platform, d.status, d.error_code AS "errorCode", d.error_message AS "errorMessage",
       d.attempts, d.sent_at AS "sentAt", CASE WHEN t.token IS NULL THEN NULL ELSE right(t.token, 6) END AS "tokenLast6"
       FROM notification_deliveries d LEFT JOIN users u ON u.id = d.user_id
       LEFT JOIN device_tokens t ON t.id = d.device_token_id WHERE d.notification_id = $1 ORDER BY d.created_at, d.id`,
      [id],
    );
    return { ...notification.rows[0], deliveries: deliveries.rows };
  }

  async reconcile(): Promise<void> {
    await this.database.transaction(async (client) => {
      await client.query(
        `UPDATE notification_deliveries SET status = 'failed', error_code = 'interrupted', error_message = 'Server restarted before completion'
         WHERE status = 'pending' AND notification_id IN (SELECT id FROM notifications WHERE status IN ('pending', 'sending'))`,
      );
      await client.query(
        `UPDATE notifications SET status = 'failed', failure_reason = 'interrupted', completed_at = now()
         WHERE status IN ('pending', 'sending')`,
      );
    });
  }

  async begin(id: string): Promise<StoredMessage | undefined> {
    const result = await this.database.query<StoredMessage>(
      `UPDATE notifications SET status = 'sending', started_at = now() WHERE id = $1 AND status = 'pending'
       RETURNING id, title, body, image_url AS "imageUrl", click_action AS "clickAction", data`,
      [id],
    );
    return result.rows[0];
  }

  async work(id: string): Promise<DeliveryWork[]> {
    const result = await this.database.query<DeliveryWork>(
      `SELECT id, device_token_id AS "deviceId", user_id AS "userId", platform, attempts
       FROM notification_deliveries WHERE notification_id = $1 AND status = 'pending' ORDER BY platform, id`,
      [id],
    );
    return result.rows;
  }

  async active(deliveryIds: string[]): Promise<ActiveDelivery[]> {
    const result = await this.database.query<ActiveDelivery>(
      `SELECT d.id, d.device_token_id AS "deviceId", d.user_id AS "userId", d.platform, d.attempts, t.token
       FROM notification_deliveries d JOIN device_tokens t ON t.id = d.device_token_id
       WHERE d.id = ANY($1::uuid[]) AND d.status = 'pending' AND t.is_active AND t.user_id = d.user_id`,
      [deliveryIds],
    );
    return result.rows;
  }

  async updateDeliveries(
    updates: DeliveryUpdate[],
    deadDeviceIds: string[] = [],
  ): Promise<void> {
    if (!updates.length && !deadDeviceIds.length) return;
    await this.database.transaction(async (client) => {
      if (updates.length)
        await client.query(
          `UPDATE notification_deliveries d SET status = v.status, fcm_message_id = v.message_id,
          error_code = v.error_code, error_message = v.error_message, attempts = v.attempts,
          sent_at = CASE WHEN v.status = 'sent' THEN now() ELSE NULL END
         FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[], $6::int[])
         AS v(id, status, message_id, error_code, error_message, attempts) WHERE d.id = v.id`,
          [
            updates.map((x) => x.id),
            updates.map((x) => x.status),
            updates.map((x) => x.messageId ?? null),
            updates.map((x) => x.code ?? null),
            updates.map((x) => x.message ?? null),
            updates.map((x) => x.attempts),
          ],
        );
      if (deadDeviceIds.length)
        await client.query(
          `UPDATE device_tokens SET is_active = false, deactivated_reason = 'fcm_unregistered', updated_at = now()
         WHERE id = ANY($1::uuid[])`,
          [deadDeviceIds],
        );
    });
  }

  async failPending(id: string, code: string, message: string): Promise<void> {
    await this.database.query(
      `UPDATE notification_deliveries SET status = 'failed', error_code = $2, error_message = $3
       WHERE notification_id = $1 AND status = 'pending'`,
      [id, code, message],
    );
  }

  async finish(id: string): Promise<void> {
    await this.database.query(
      `UPDATE notifications SET status = CASE
         WHEN counts.failed = 0 AND counts.pending = 0 THEN 'completed'
         WHEN counts.sent > 0 THEN 'partial' ELSE 'failed' END, completed_at = now()
       FROM (SELECT count(*) FILTER (WHERE status = 'sent') AS sent,
         count(*) FILTER (WHERE status = 'failed') AS failed, count(*) FILTER (WHERE status = 'pending') AS pending
         FROM notification_deliveries WHERE notification_id = $1) counts WHERE id = $1`,
      [id],
    );
  }
}
