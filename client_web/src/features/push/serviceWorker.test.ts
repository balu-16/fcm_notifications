import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

describe('background notification clicks', () => {
  it('focuses an existing same-origin tab and navigates to a relative click path', async () => {
    let click!: (event: object) => void;
    const navigate = vi.fn(async () => undefined);
    const focus = vi.fn(async () => undefined);
    const openWindow = vi.fn();
    const self = {
      location: {
        href: 'http://localhost:5173/firebase-messaging-sw.js?projectId=test',
        origin: 'http://localhost:5173',
      },
      addEventListener: (_name: string, handler: typeof click) => {
        click = handler;
      },
      clients: {
        matchAll: async () => [
          { url: 'http://localhost:5173/', navigate, focus },
        ],
        openWindow,
      },
    };
    runInNewContext(
      readFileSync(
        resolve(process.cwd(), 'public/firebase-messaging-sw.js'),
        'utf8',
      ),
      {
        self,
        URL,
        importScripts: () => undefined,
        firebase: {
          initializeApp: () => undefined,
          messaging: () => undefined,
        },
      },
    );
    let work: Promise<unknown> | undefined;
    click({
      notification: {
        data: { FCM_MSG: { data: { clickAction: '/updates' } } },
        close: () => undefined,
      },
      stopImmediatePropagation: () => undefined,
      waitUntil: (promise: Promise<unknown>) => {
        work = promise;
      },
    });
    await work;
    expect(navigate).toHaveBeenCalledWith('http://localhost:5173/updates');
    expect(focus).toHaveBeenCalledOnce();
    expect(openWindow).not.toHaveBeenCalled();
  });
});
