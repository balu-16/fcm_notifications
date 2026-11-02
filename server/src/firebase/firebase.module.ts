import { Inject, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  cert,
  deleteApp,
  initializeApp,
  type App,
  type ServiceAccount,
} from 'firebase-admin/app';
import {
  getMessaging,
  type BaseMessage,
  type Messaging,
} from 'firebase-admin/messaging';
import { APP_CONFIG, type AppConfig } from '../config/config.module.js';
import type { NotificationPayload } from '../notifications/validation.js';

export type Platform = 'web' | 'android';
export interface SendResult {
  success: boolean;
  messageId?: string;
  code?: string;
  retryAfterMs?: number;
}

export function retryAfterMs(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = error as {
    retryAfter?: unknown;
    headers?: unknown;
    response?: { headers?: unknown };
  };
  const headers = value.response?.headers ?? value.headers;
  let header = value.retryAfter;
  if (!header && headers && typeof headers === 'object') {
    const collection = headers as {
      get?: (name: string) => unknown;
      [key: string]: unknown;
    };
    header =
      typeof collection.get === 'function'
        ? collection.get('retry-after')
        : collection['retry-after'];
  }
  if (typeof header !== 'string' && typeof header !== 'number')
    return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(String(header));
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

@Injectable()
export class FirebaseGateway implements OnModuleDestroy {
  private readonly app: App;
  private readonly messaging: Messaging;
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    try {
      const contents: unknown = JSON.parse(
        readFileSync(resolve(config.firebaseServiceAccountPath), 'utf8'),
      );
      if (
        !contents ||
        typeof contents !== 'object' ||
        !('private_key' in contents) ||
        !('client_email' in contents) ||
        !('project_id' in contents)
      )
        throw new Error('Invalid service account');
      this.app = initializeApp(
        { credential: cert(contents as ServiceAccount) },
        'notification-server',
      );
      this.messaging = getMessaging(this.app);
    } catch {
      throw new Error(
        'Firebase service-account file is missing or invalid; check FIREBASE_SERVICE_ACCOUNT_PATH',
      );
    }
  }
  async send(
    platform: Platform,
    identifiers: string[],
    payload: NotificationPayload,
    notificationId: string,
  ): Promise<SendResult[]> {
    const data = {
      ...payload.data,
      notificationId,
      ...(payload.clickAction ? { clickAction: payload.clickAction } : {}),
    };
    const link = payload.clickAction?.startsWith('https://')
      ? payload.clickAction
      : undefined;
    const message: BaseMessage = {
      notification: {
        title: payload.title,
        body: payload.body,
        ...(payload.imageUrl ? { imageUrl: payload.imageUrl } : {}),
      },
      data,
      webpush: {
        headers: { TTL: '86400' },
        ...(link ? { fcmOptions: { link } } : {}),
      },
      android: {
        priority: 'high',
        ttl: 86_400_000,
        notification: { channelId: 'default' },
      },
    };
    // Web uses current FIDs; Expo Android currently exposes legacy native tokens.
    const result =
      platform === 'web'
        ? await this.messaging.sendEachForMulticast({
            ...message,
            fids: identifiers,
          })
        : await this.messaging.sendEachForMulticast({
            ...message,
            tokens: identifiers,
          });
    return result.responses.map((item) => ({
      success: item.success,
      ...(item.messageId ? { messageId: item.messageId } : {}),
      ...(item.error?.code ? { code: item.error.code } : {}),
      ...(retryAfterMs(item.error) !== undefined
        ? { retryAfterMs: retryAfterMs(item.error) }
        : {}),
    }));
  }
  async onModuleDestroy(): Promise<void> {
    await deleteApp(this.app);
  }
}
@Module({ providers: [FirebaseGateway], exports: [FirebaseGateway] })
export class FirebaseModule {}
