import { idToken } from './auth';

export interface Me {
  id: string;
  email: string;
  role: 'user' | 'admin';
}
export interface UserItem {
  id: string;
  email: string;
  role: string;
  webDevices: number;
  androidDevices: number;
  lastLoginAt: string | null;
}
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}
export type Platform = 'web' | 'android';
export type Target =
  | { type: 'all' }
  | { type: 'users'; userIds: string[] }
  | { type: 'platform'; platform: Platform };
export interface NotificationInput {
  title: string;
  body: string;
  imageUrl?: string;
  clickAction?: string;
  data?: Record<string, string>;
  target: Target;
}
export interface Preview {
  totalDevices: number;
  totalUsers: number;
  skippedUsers: string[];
}
export interface Created {
  id: string;
  status: string;
  totalDevices: number;
  skippedUsers: string[];
}
export interface HistoryItem {
  id: string;
  title: string;
  targetType: string;
  targetPlatform: string | null;
  status: string;
  totalDevices: number;
  createdAt: string;
  creatorEmail: string;
  sent: number;
  failed: number;
  pending: number;
}
export interface Delivery {
  id: string;
  email: string | null;
  platform: Platform;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  sentAt: string | null;
  tokenLast6: string | null;
}
export interface Detail {
  id: string;
  body: string;
  deliveries: Delivery[];
  failureReason?: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly requestId?: string,
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
  const token = await idToken(!retry);
  if (!token) {
    unauthorized();
    throw new ApiError(401, 'Your session has expired. Please sign in again.');
  }
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), path === '/me' ? 25_000 : 10_000);
  let response: Response;
  try {
    const base = (import.meta.env.VITE_API_URL?.trim() || '/api').replace(/\/+$/, '');
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
      requestId?: string;
    };
    if (response.status === 401) unauthorized();
    throw new ApiError(
      response.status,
      Array.isArray(body.message)
        ? body.message.join(', ')
        : body.message || `Request failed (${response.status})`,
      body.requestId,
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
      body: JSON.stringify({ token, platform: 'web' }),
    }),
  unregister: (token: string) =>
    request<void>('/devices', {
      method: 'DELETE',
      body: JSON.stringify({ token }),
    }),
  users: (search: string, page: number) =>
    request<Page<UserItem>>(
      `/admin/users?${new URLSearchParams({ search, page: String(page), limit: '10' })}`,
    ),
  preview: (target: Target) =>
    request<Preview>('/admin/notifications/preview', {
      method: 'POST',
      body: JSON.stringify({ target }),
    }),
  send: (data: NotificationInput, key: string) =>
    request<Created>('/admin/notifications', {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify(data),
    }),
  history: (page: number) =>
    request<Page<HistoryItem>>(`/admin/notifications?page=${page}&limit=10`),
  detail: (id: string) =>
    request<Detail>(`/admin/notifications/${encodeURIComponent(id)}`),
};
