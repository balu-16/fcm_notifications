import { idToken } from './auth';
export interface Me {
  id: string;
  email: string;
  role: 'user' | 'admin';
}
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
let unauthorized: () => void = () => undefined;
export function onUnauthorized(callback: () => void): void {
  unauthorized = callback;
}
async function request<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const base = process.env.EXPO_PUBLIC_API_URL;
  if (!base)
    throw new Error(
      'Set EXPO_PUBLIC_API_URL to your computer’s LAN URL or HTTPS tunnel.',
    );
  const token = await idToken(!retry);
  if (!token) {
    unauthorized();
    throw new ApiError(401, 'Session expired. Please sign in again.');
  }
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (response.status === 401 && retry) {
    try {
      return await request<T>(path, init, false);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status === 401) unauthorized();
      throw error;
    }
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      message?: string | string[];
    };
    if (response.status === 401) unauthorized();
    throw new ApiError(
      response.status,
      Array.isArray(body.message)
        ? body.message.join(', ')
        : body.message || 'API request failed.',
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export const api = {
  me: () => request<Me>('/me'),
  register: (token: string) =>
    request<{ registered: boolean }>('/devices', {
      method: 'POST',
      body: JSON.stringify({ token, platform: 'android' }),
    }),
  unregister: (token: string) =>
    request<void>('/devices', {
      method: 'DELETE',
      body: JSON.stringify({ token }),
    }),
};
