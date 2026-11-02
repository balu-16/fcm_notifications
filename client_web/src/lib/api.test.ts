import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./auth', () => ({ idToken: vi.fn().mockResolvedValue('test-token') }));

describe('API address', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ role: 'user' }),
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('uses a same-origin proxy by default', async () => {
    vi.stubEnv('VITE_API_URL', '');
    const { api } = await import('./api');
    await api.me();
    expect(fetch).toHaveBeenCalledWith('/api/me', expect.objectContaining({
      headers: expect.any(Headers),
    }));
  });

  it('supports an explicitly configured API origin', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.test/');
    const { api } = await import('./api');
    await api.me();
    expect(fetch).toHaveBeenCalledWith('https://api.example.test/me', expect.anything());
  });
});
