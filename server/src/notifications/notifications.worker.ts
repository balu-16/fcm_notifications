import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import {
  FirebaseGateway,
  retryAfterMs,
  type Platform,
  type SendResult,
} from '../firebase/firebase.module.js';
import {
  NotificationsRepository,
  type ActiveDelivery,
  type DeliveryUpdate,
  type DeliveryWork,
} from './notifications.repository.js';
import type { NotificationPayload } from './validation.js';

type Classification = 'dead' | 'transient' | 'auth' | 'invalid' | 'other';
const deadCodes = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);
const authCodes = new Set([
  'messaging/third-party-auth-error',
  'messaging/authentication-error',
  'messaging/mismatched-credential',
  'messaging/invalid-credential',
]);
const transientCodes = new Set([
  'messaging/server-unavailable',
  'messaging/internal-error',
  'messaging/quota-exceeded',
  'messaging/message-rate-exceeded',
  'messaging/device-message-rate-exceeded',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
]);
export function classifyError(code: string): Classification {
  if (deadCodes.has(code)) return 'dead';
  if (authCodes.has(code)) return 'auth';
  if (transientCodes.has(code)) return 'transient';
  if (code === 'messaging/invalid-argument') return 'invalid';
  return 'other';
}
export function chunks<T>(items: T[], size = 500): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    result.push(items.slice(index, index + size));
  return result;
}
function codeOf(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : 'messaging/unknown-error';
}
function safeMessage(kind: Classification): string {
  if (kind === 'dead') return 'Registration is no longer valid';
  if (kind === 'transient') return 'FCM temporarily unavailable';
  if (kind === 'auth') return 'FCM authentication or configuration failed';
  if (kind === 'invalid') return 'FCM rejected an invalid message argument';
  return 'FCM could not accept this message';
}

@Injectable()
export class NotificationsWorker implements OnApplicationBootstrap {
  private readonly queue: string[] = [];
  private running = false;
  constructor(
    @Inject(NotificationsRepository)
    private readonly repository: NotificationsRepository,
    @Inject(FirebaseGateway) private readonly firebase: FirebaseGateway,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.repository.reconcile();
  }

  enqueue(id: string): void {
    this.queue.push(id);
    if (!this.running) {
      this.running = true;
      void this.drain();
    }
  }

  private async drain(): Promise<void> {
    while (this.queue.length) {
      const id = this.queue.shift()!;
      try {
        await this.process(id);
      } catch {
        console.error(
          JSON.stringify({
            level: 'error',
            message: 'Notification worker failed',
            notificationId: id,
          }),
        );
        try {
          await this.repository.failPending(
            id,
            'internal_error',
            'Notification processing failed',
          );
          await this.repository.finish(id);
        } catch {
          console.error(
            JSON.stringify({
              level: 'error',
              message: 'Could not finalize notification',
              notificationId: id,
            }),
          );
        }
      }
    }
    this.running = false;
  }

  private async process(id: string): Promise<void> {
    const stored = await this.repository.begin(id);
    if (!stored) return;
    const payload: NotificationPayload = {
      title: stored.title,
      body: stored.body,
      data: stored.data,
      ...(stored.imageUrl ? { imageUrl: stored.imageUrl } : {}),
      ...(stored.clickAction ? { clickAction: stored.clickAction } : {}),
    };
    const work = await this.repository.work(id);
    for (const platform of ['web', 'android'] as const) {
      for (const chunk of chunks(
        work.filter((item) => item.platform === platform),
      )) {
        const fatal = await this.sendChunk(id, platform, chunk, payload);
        if (fatal) {
          await this.repository.failPending(
            id,
            'fcm_auth_error',
            'FCM authentication or configuration failed',
          );
          await this.repository.finish(id);
          return;
        }
      }
    }
    await this.repository.finish(id);
  }

  private async sendChunk(
    id: string,
    platform: Platform,
    initial: DeliveryWork[],
    payload: NotificationPayload,
  ): Promise<boolean> {
    let pending = initial;
    while (pending.length) {
      // Recheck ownership immediately before each send so a reassigned shared device is not knowingly targeted.
      const active = await this.repository.active(
        pending.map((item) => item.id),
      );
      const activeIds = new Set(active.map((item) => item.id));
      const missing: DeliveryUpdate[] = pending
        .filter((item) => !activeIds.has(item.id))
        .map((item) => ({
          id: item.id,
          status: 'failed',
          code: 'registration_changed',
          message: 'Device is inactive or belongs to another user',
          attempts: item.attempts,
        }));
      await this.repository.updateDeliveries(missing);
      if (!active.length) return false;
      let responses: SendResult[];
      try {
        responses = await this.firebase.send(
          platform,
          active.map((item) => item.token),
          payload,
          id,
        );
      } catch (error) {
        responses = active.map(() => ({
          success: false,
          code: codeOf(error),
          retryAfterMs: retryAfterMs(error),
        }));
      }
      if (responses.length !== active.length)
        throw new Error('FCM result count mismatch');
      const next: ActiveDelivery[] = [];
      const updates: DeliveryUpdate[] = [];
      const deadDeviceIds: string[] = [];
      let fatal = false;
      let quota = false;
      let requestedDelay = 0;
      for (let index = 0; index < active.length; index++) {
        const item = active[index];
        const response = responses[index];
        const attempts = item.attempts + 1;
        if (response.success) {
          updates.push({
            id: item.id,
            status: 'sent',
            messageId: response.messageId,
            attempts,
          });
          continue;
        }
        const code = response.code ?? 'messaging/unknown-error';
        const kind = classifyError(code);
        if (kind === 'dead' && item.deviceId) deadDeviceIds.push(item.deviceId);
        if (kind === 'auth') fatal = true;
        if (kind === 'invalid' || kind === 'auth')
          console.error(
            JSON.stringify({
              level: 'error',
              message: 'FCM rejected a notification',
              notificationId: id,
              code,
            }),
          );
        if (kind === 'transient' && attempts < 3) {
          next.push({ ...item, attempts });
          quota ||= code.includes('quota') || code.includes('rate-exceeded');
          requestedDelay = Math.max(requestedDelay, response.retryAfterMs ?? 0);
          updates.push({
            id: item.id,
            status: 'pending',
            code,
            message: safeMessage(kind),
            attempts,
          });
        } else
          updates.push({
            id: item.id,
            status: 'failed',
            code,
            message: safeMessage(kind),
            attempts,
          });
      }
      await this.repository.updateDeliveries(updates, deadDeviceIds);
      if (fatal) return true;
      pending = next;
      if (pending.length) {
        const attempt = Math.max(...pending.map((item) => item.attempts));
        // FCM quota errors require at least a one-minute first delay; jitter avoids synchronized retries.
        const base = (quota ? 60_000 : 1000) * 2 ** (attempt - 1);
        const minimum = Math.max(base, requestedDelay);
        await new Promise((resolve) =>
          setTimeout(resolve, minimum + Math.random() * base * 0.25),
        );
      }
    }
    return false;
  }
}
