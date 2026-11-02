// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MessagePayload } from 'firebase/messaging';
import { displayForegroundNotification } from './displayNotification';

const payload = {
  from: 'test',
  collapseKey: '',
  messageId: 'fcm',
  data: { notificationId: '123', clickAction: '/updates' },
  notification: { title: 'Hello', body: 'World' },
} as MessagePayload;
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
describe('foreground system notifications', () => {
  it('uses the active registration and deduplicates by notification ID', async () => {
    vi.stubGlobal('Notification', { permission: 'granted' });
    const showNotification = vi.fn(async () => undefined);
    const worker = {
      active: {},
      getNotifications: vi.fn(async () => []),
      showNotification,
    } as unknown as ServiceWorkerRegistration;
    await displayForegroundNotification(worker, payload);
    await displayForegroundNotification(worker, payload);
    expect(showNotification).toHaveBeenCalledOnce();
    expect(showNotification).toHaveBeenCalledWith(
      'Hello',
      expect.objectContaining({
        body: 'World',
        tag: 'notification-123',
        data: { FCM_MSG: { data: { clickAction: '/updates' } } },
      }),
    );
  });
  it('reports display failures and permits retry', async () => {
    vi.stubGlobal('Notification', { permission: 'granted' });
    const showNotification = vi
      .fn()
      .mockRejectedValueOnce(new Error())
      .mockResolvedValueOnce(undefined);
    const worker = {
      active: {},
      getNotifications: vi.fn(async () => []),
      showNotification,
    } as unknown as ServiceWorkerRegistration;
    await expect(
      displayForegroundNotification(worker, payload),
    ).rejects.toThrow('could not display');
    await expect(
      displayForegroundNotification(worker, payload),
    ).resolves.toBeUndefined();
  });
  it('does not display without permission or an active worker', async () => {
    vi.stubGlobal('Notification', { permission: 'denied' });
    const worker = { active: null } as unknown as ServiceWorkerRegistration;
    await expect(
      displayForegroundNotification(worker, payload),
    ).rejects.toThrow('permission');
    vi.stubGlobal('Notification', { permission: 'granted' });
    await expect(
      displayForegroundNotification(worker, payload),
    ).rejects.toThrow('not active');
  });
});
