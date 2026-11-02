import { UnprocessableEntityException } from '@nestjs/common';
import type { NotificationDto, TargetDto } from './notifications.dto.js';

export interface NotificationPayload {
  title: string;
  body: string;
  imageUrl?: string;
  clickAction?: string;
  data: Record<string, string>;
}
function invalid(message: string): never {
  throw new UnprocessableEntityException(message);
}

export function validateTarget(target: TargetDto): TargetDto {
  if (!target || !['all', 'users', 'platform'].includes(target.type))
    invalid('A valid target is required');
  if (target.type === 'users') {
    if (!target.userIds?.length || target.platform !== undefined)
      invalid('Select at least one user and omit platform');
    return {
      type: 'users',
      userIds: [...new Set(target.userIds.map((id) => id.toLowerCase()))],
    };
  }
  if (target.type === 'platform') {
    if (!target.platform || target.userIds !== undefined)
      invalid('Choose one platform and omit userIds');
    return { type: 'platform', platform: target.platform };
  }
  if (target.userIds !== undefined || target.platform !== undefined)
    invalid('All-users targets cannot include userIds or platform');
  return { type: 'all' };
}

export function validClickAction(value: string, development: boolean): boolean {
  if (
    !value ||
    /[\u0000-\u001f\u007f\\]/u.test(value) ||
    value.startsWith('//')
  )
    return false;
  if (value.startsWith('/')) return true;
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    return (
      url.protocol === 'https:' ||
      (development && url.protocol === 'http:' && url.hostname === 'localhost')
    );
  } catch {
    return false;
  }
}

export function validatePayload(
  dto: NotificationDto,
  development: boolean,
): NotificationPayload {
  const data: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  const entries = Object.entries(dto.data ?? {});
  if (entries.length > 10) invalid('Custom data may contain at most 10 keys');
  for (const [key, value] of entries) {
    const lower = key.toLowerCase();
    if (
      !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) ||
      lower.startsWith('google') ||
      lower.startsWith('gcm') ||
      [
        'from',
        'notification',
        'message_type',
        'clickaction',
        'notificationid',
        '__proto__',
        'constructor',
        'prototype',
      ].includes(lower)
    ) {
      invalid(`Invalid or reserved data key: ${key}`);
    }
    if (typeof value !== 'string' || value.length > 256)
      invalid(
        `Data value for ${key} must be a string of at most 256 characters`,
      );
    data[key] = value;
  }
  if (dto.clickAction && !validClickAction(dto.clickAction, development))
    invalid(
      'clickAction must be a safe HTTPS URL or single-slash relative path',
    );
  if (dto.imageUrl) {
    try {
      const url = new URL(dto.imageUrl);
      if (url.protocol !== 'https:' || url.username || url.password)
        invalid('imageUrl must be an HTTPS URL');
    } catch {
      invalid('imageUrl must be an HTTPS URL');
    }
  }
  const payload = {
    title: dto.title,
    body: dto.body,
    ...(dto.imageUrl ? { imageUrl: dto.imageUrl } : {}),
    ...(dto.clickAction ? { clickAction: dto.clickAction } : {}),
    data,
  };
  // Include platform options and a full UUID so the check is conservative for FCM's 4096-byte payload limit.
  const representative = {
    notification: { title: dto.title, body: dto.body, imageUrl: dto.imageUrl },
    data: {
      ...data,
      notificationId: '00000000-0000-4000-8000-000000000000',
      ...(dto.clickAction ? { clickAction: dto.clickAction } : {}),
    },
    webpush: {
      headers: { TTL: '86400' },
      fcmOptions: { link: dto.clickAction },
    },
    android: {
      priority: 'high',
      ttl: 86400000,
      notification: { channelId: 'default' },
    },
  };
  if (Buffer.byteLength(JSON.stringify(representative), 'utf8') > 4000)
    invalid('Notification payload exceeds 4000 bytes');
  return payload;
}
