import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const storage = new Map<string, string>();
  return {
    storage,
    channel: vi.fn(async () => undefined),
    getPermission: vi.fn(async () => ({
      granted: false,
      status: 'undetermined',
      canAskAgain: true,
    })),
    requestPermission: vi.fn(async () => ({
      granted: true,
      status: 'granted',
      canAskAgain: true,
    })),
    deviceToken: vi.fn(async () => ({
      type: 'android',
      data: 'test-native-registration',
    })),
    register: vi.fn(async () => ({ registered: true })),
    unregister: vi.fn(async () => undefined),
    listener: vi.fn(() => ({ remove: vi.fn() })),
  };
});
vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  AppState: { addEventListener: mocks.listener },
}));
vi.mock('expo-device', () => ({ isDevice: true }));
vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  setNotificationChannelAsync: mocks.channel,
  getPermissionsAsync: mocks.getPermission,
  requestPermissionsAsync: mocks.requestPermission,
  getDevicePushTokenAsync: mocks.deviceToken,
  addPushTokenListener: mocks.listener,
  unregisterForNotificationsAsync: vi.fn(async () => undefined),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => mocks.storage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      mocks.storage.set(key, value);
    },
    removeItem: async (key: string) => {
      mocks.storage.delete(key);
    },
  },
}));
vi.mock('../src/api', () => ({
  api: { register: mocks.register, unregister: mocks.unregister },
}));
import { usePush } from '../src/usePush';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  if (renderer)
    await act(async () => {
      renderer?.unmount();
    });
  renderer = undefined;
  mocks.storage.clear();
  vi.clearAllMocks();
});

describe('Android notification registration', () => {
  it('creates a channel without prompting on launch, then requests permission only on enable', async () => {
    let push!: ReturnType<typeof usePush>;
    function Harness() {
      push = usePush('user-id');
      return null;
    }
    await act(async () => {
      renderer = create(createElement(Harness));
    });
    expect(mocks.channel).toHaveBeenCalled();
    expect(mocks.requestPermission).not.toHaveBeenCalled();
    await act(async () => {
      await push.enable();
    });
    expect(mocks.requestPermission).toHaveBeenCalledTimes(1);
    expect(mocks.channel.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.requestPermission.mock.invocationCallOrder[0],
    );
    expect(mocks.register).toHaveBeenCalledWith('test-native-registration');
    expect(push.status).toBe('registered');
  });
  it('shows a permanent denial without requesting permission again', async () => {
    mocks.getPermission.mockResolvedValueOnce({
      granted: false,
      status: 'denied',
      canAskAgain: false,
    });
    let push!: ReturnType<typeof usePush>;
    function Harness() {
      push = usePush('user-id');
      return null;
    }
    await act(async () => {
      renderer = create(createElement(Harness));
    });
    expect(push.status).toBe('denied');
    expect(push.canAskAgain).toBe(false);
    expect(mocks.requestPermission).not.toHaveBeenCalled();
  });
});
