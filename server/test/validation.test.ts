import { describe, expect, it } from 'vitest';
import {
  chunks,
  classifyError,
} from '../src/notifications/notifications.worker.js';
import {
  validClickAction,
  validatePayload,
  validateTarget,
} from '../src/notifications/validation.js';
import type { NotificationDto } from '../src/notifications/notifications.dto.js';
import { retryAfterMs } from '../src/firebase/firebase.module.js';

const basic: NotificationDto = {
  title: 'Hello',
  body: 'World',
  target: { type: 'all' },
};
describe('notification validation and batching', () => {
  it('batches exactly 500 identifiers', () => {
    expect(chunks(Array.from({ length: 500 }))).toHaveLength(1);
    expect(
      chunks(Array.from({ length: 501 })).map((part) => part.length),
    ).toEqual([500, 1]);
  });
  it('classifies dead registrations separately from invalid payloads and transient errors', () => {
    expect(classifyError('messaging/registration-token-not-registered')).toBe(
      'dead',
    );
    expect(classifyError('messaging/invalid-argument')).toBe('invalid');
    expect(classifyError('messaging/quota-exceeded')).toBe('transient');
    expect(classifyError('messaging/authentication-error')).toBe('auth');
  });
  it('rejects unsafe click actions, reserved keys, nonstrings and oversized payloads', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,x',
      '//evil.example',
      '/\\evil.example',
      'http://example.com',
    ]) {
      expect(validClickAction(url, true)).toBe(false);
    }
    expect(validClickAction('/messages', false)).toBe(true);
    expect(validClickAction('http://localhost:5173/test', true)).toBe(true);
    expect(validClickAction('http://localhost:5173/test', false)).toBe(false);
    expect(() =>
      validatePayload({ ...basic, data: { googleThing: 'x' } }, false),
    ).toThrow();
    expect(() =>
      validatePayload({ ...basic, data: { notificationId: 'x' } }, false),
    ).toThrow();
    expect(() =>
      validatePayload({ ...basic, data: { count: 42 } }, false),
    ).toThrow();
    const data = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`key${i}`, 'x'.repeat(256)]),
    );
    expect(() =>
      validatePayload(
        { ...basic, imageUrl: `https://example.com/${'a'.repeat(1800)}`, data },
        false,
      ),
    ).toThrow(/4000/);
  });
  it('requires a meaningful target and rejects incompatible fields', () => {
    expect(() => validateTarget({ type: 'users', userIds: [] })).toThrow();
    expect(() => validateTarget({ type: 'all', platform: 'web' })).toThrow();
    expect(validateTarget({ type: 'platform', platform: 'android' })).toEqual({
      type: 'platform',
      platform: 'android',
    });
  });
  it('honors a Retry-After delay when the SDK exposes one', () => {
    expect(
      retryAfterMs({ response: { headers: { 'retry-after': '90' } } }),
    ).toBe(90_000);
    expect(retryAfterMs({})).toBeUndefined();
  });
});
