import { expect, test, type Page } from '@playwright/test';

const userId = '00000000-0000-4000-8000-000000000001';
async function mockAdmin(page: Page) {
  await page.route('**/src/lib/auth.ts*', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: 'export function configureAuth(){}; export async function idToken(){return "test-token"}; export async function clearSession(){};',
    }),
  );
  await page.addInitScript(() => {
    Object.defineProperty(Notification, 'permission', {
      configurable: true,
      value: 'denied',
    });
  });
  await page.route('http://localhost:3000/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers':
        'authorization,content-type,idempotency-key',
      'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    };
    if (request.method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers });
    if (url.pathname === '/me')
      return route.fulfill({
        status: 200,
        headers,
        json: { id: userId, email: 'admin@example.test', role: 'admin' },
      });
    if (url.pathname === '/admin/notifications/preview')
      return route.fulfill({
        status: 200,
        headers,
        json: { totalDevices: 2, totalUsers: 1, skippedUsers: [] },
      });
    if (url.pathname === '/admin/notifications' && request.method() === 'POST')
      return route.fulfill({
        status: 202,
        headers,
        json: {
          id: '00000000-0000-4000-8000-000000000002',
          status: 'pending',
          totalDevices: 2,
          skippedUsers: [],
        },
      });
    if (url.pathname === '/admin/notifications')
      return route.fulfill({
        status: 200,
        headers,
        json: { items: [], total: 0, page: 1, limit: 10 },
      });
    if (url.pathname === '/admin/users')
      return route.fulfill({
        status: 200,
        headers,
        json: { items: [], total: 0, page: 1, limit: 10 },
      });
    return route.fulfill({ status: 404, headers, json: {} });
  });
}

test('admin can review and send with a request key', async ({ page }) => {
  await mockAdmin(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Compose notification' }),
  ).toBeVisible();
  await page.screenshot({
    path: '/tmp/notifications-admin.png',
    fullPage: true,
  });
  await page.getByLabel('Title').fill('Test title');
  await page.getByLabel(/^Message/).fill('Test body');
  await page.getByRole('button', { name: /Review recipients/ }).click();
  await expect(page.getByRole('dialog')).toContainText(
    '2 devices across 1 user',
  );
  const sent = page.waitForRequest(
    (request) =>
      request.url().endsWith('/admin/notifications') &&
      request.method() === 'POST',
  );
  await page.getByRole('button', { name: 'Send notification' }).click();
  const request = await sent;
  expect(request.headers()['idempotency-key']).toBeTruthy();
  expect(request.postDataJSON()).toMatchObject({
    title: 'Test title',
    body: 'Test body',
    target: { type: 'all' },
  });
  await expect(
    page.getByRole('status').filter({ hasText: 'Queued notification' }),
  ).toBeVisible();
});

test('dashboard is usable on a narrow viewport', async ({ page }) => {
  await mockAdmin(page);
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Compose notification' }),
  ).toBeVisible();
  await page.screenshot({
    path: '/tmp/notifications-mobile.png',
    fullPage: true,
  });
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
});

test('an uncertain network failure retries the same notification with the same key', async ({
  page,
}) => {
  await mockAdmin(page);
  const keys: string[] = [];
  await page.route(
    'http://localhost:3000/admin/notifications',
    async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      keys.push(route.request().headers()['idempotency-key']);
      if (keys.length === 1) return route.abort('failed');
      return route.fulfill({
        status: 200,
        headers: { 'access-control-allow-origin': '*' },
        json: {
          id: '00000000-0000-4000-8000-000000000002',
          status: 'completed',
          totalDevices: 2,
          skippedUsers: [],
        },
      });
    },
  );
  await page.goto('/');
  await page.getByLabel('Title').fill('Retry safely');
  await page.getByLabel(/^Message/).fill('Same request');
  await page.getByRole('button', { name: /Review recipients/ }).click();
  await page.getByRole('button', { name: 'Send notification' }).click();
  await expect(page.getByRole('button', { name: 'Retry send' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry send' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Queued notification' }),
  ).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
});
