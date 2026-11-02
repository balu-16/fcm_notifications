import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { NotificationsWorker } from '../src/notifications/notifications.worker.js';
import type {
  NotificationsRepository,
  DeliveryWork,
} from '../src/notifications/notifications.repository.js';
import type { FirebaseGateway } from '../src/firebase/firebase.module.js';

function harness(
  count: number,
  responses: (tokens: string[], call: number) => object[],
) {
  const work: DeliveryWork[] = Array.from({ length: count }, (_, index) => ({
    id: `delivery-${index}`,
    deviceId: `device-${index}`,
    userId: 'user',
    platform: 'web',
    attempts: 0,
  }));
  const attempts = new Map<string, number>();
  const repository = {
    begin: vi.fn(async () => ({
      id: 'notification',
      title: 'Hello',
      body: 'World',
      imageUrl: null,
      clickAction: null,
      data: {},
    })),
    work: vi.fn(async () => work),
    active: vi.fn(async (ids: string[]) =>
      ids.map((id) => {
        const item = work.find((candidate) => candidate.id === id)!;
        return {
          ...item,
          attempts: attempts.get(id) ?? 0,
          token: `token-${id}`,
        };
      }),
    ),
    updateDeliveries: vi.fn(
      async (updates: { id: string; attempts: number }[]) => {
        updates.forEach((item) => attempts.set(item.id, item.attempts));
      },
    ),
    failPending: vi.fn(async () => undefined),
    finish: vi.fn(async () => undefined),
  };
  let calls = 0;
  const firebase = {
    send: vi.fn(async (_platform: string, tokens: string[]) =>
      responses(tokens, ++calls),
    ),
  };
  return {
    worker: new NotificationsWorker(
      repository as unknown as NotificationsRepository,
      firebase as unknown as FirebaseGateway,
    ),
    repository,
    firebase,
  };
}

describe('notification worker', () => {
  it('sends 501 devices in sequential 500 and 1 batches', async () => {
    const { worker, repository, firebase } = harness(501, (tokens) =>
      tokens.map(() => ({ success: true, messageId: 'accepted' })),
    );
    worker.enqueue('notification');
    await vi.waitFor(() => expect(repository.finish).toHaveBeenCalledOnce());
    expect(firebase.send.mock.calls.map((call) => call[1].length)).toEqual([
      500, 1,
    ]);
  });
  it('retries only transiently failed devices', async () => {
    const { worker, repository, firebase } = harness(2, (tokens, call) =>
      tokens.map((_, index) =>
        call === 1 && index === 1
          ? { success: false, code: 'messaging/server-unavailable' }
          : { success: true, messageId: 'accepted' },
      ),
    );
    worker.enqueue('notification');
    await vi.waitFor(() => expect(repository.finish).toHaveBeenCalledOnce(), {
      timeout: 4000,
    });
    expect(firebase.send.mock.calls.map((call) => call[1].length)).toEqual([
      2, 1,
    ]);
  });
  it('stops remaining chunks when FCM authentication fails', async () => {
    const { worker, repository, firebase } = harness(501, (tokens) =>
      tokens.map(() => ({
        success: false,
        code: 'messaging/authentication-error',
      })),
    );
    worker.enqueue('notification');
    await vi.waitFor(() => expect(repository.finish).toHaveBeenCalledOnce());
    expect(firebase.send).toHaveBeenCalledTimes(1);
    expect(repository.failPending).toHaveBeenCalledWith(
      'notification',
      'fcm_auth_error',
      expect.any(String),
    );
  });
});
