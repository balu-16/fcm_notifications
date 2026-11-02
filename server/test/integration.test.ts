import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Database } from '../src/database/database.module.js';
import { DevicesRepository } from '../src/devices/devices.repository.js';
import { NotificationsRepository } from '../src/notifications/notifications.repository.js';
import { NotificationsWorker } from '../src/notifications/notifications.worker.js';
import type { FirebaseGateway } from '../src/firebase/firebase.module.js';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { UsersRepository } from '../src/users/users.repository.js';
import type { AppConfig } from '../src/config/config.module.js';

const connectionString = process.env.TEST_DATABASE_URL;
const suite = connectionString ? describe : describe.skip;
suite('PostgreSQL integration', () => {
  const suffix = randomUUID();
  const principal = (name: string) => ({
    sub: `test-${suffix}-${name}`,
    email: `${name}@example.test`,
    role: 'user' as const,
  });
  let db: Database;
  let users: UsersRepository;
  let devices: DevicesRepository;
  let notifications: NotificationsRepository;
  let userA: string;
  let userB: string;
  beforeAll(async () => {
    db = new Database({ databaseUrl: connectionString! } as AppConfig);
    users = new UsersRepository(db);
    devices = new DevicesRepository(db);
    notifications = new NotificationsRepository(db);
    const [a, again] = await Promise.all([
      users.upsert(principal('a'), true),
      users.upsert(principal('a'), true),
    ]);
    expect(a.id).toBe(again.id);
    userA = a.id;
    userB = (await users.upsert(principal('b'), true)).id;
  });
  afterAll(async () => {
    if (!db) return;
    await db.query(
      'DELETE FROM notifications WHERE created_by = ANY($1::uuid[])',
      [[userA, userB]],
    );
    await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
      [userA, userB],
    ]);
    await db.onModuleDestroy();
  });
  it('reassigns a shared device and prevents its previous owner from disabling it', async () => {
    const token = `web-${suffix}`;
    await devices.register(userA, { token, platform: 'web' });
    await devices.register(userB, { token, platform: 'web' });
    await devices.deactivate(userA, token);
    const row = await db.query<{ user_id: string; is_active: boolean }>(
      'SELECT user_id, is_active FROM device_tokens WHERE token = $1',
      [token],
    );
    expect(row.rows[0]).toEqual({ user_id: userB, is_active: true });
  });
  it('stores one notification under simultaneous idempotent submissions', async () => {
    await devices.register(userA, {
      token: `android-${suffix}`,
      platform: 'android',
    });
    const target = { type: 'users' as const, userIds: [userA] };
    const message = { title: 'Hello', body: 'World', data: {} };
    const [first, second] = await Promise.all([
      notifications.create(userA, 'concurrent', target, message),
      notifications.create(userA, 'concurrent', target, message),
    ]);
    expect(first.notification.id).toBe(second.notification.id);
    expect([first.replay, second.replay].sort()).toEqual([false, true]);
    const rows = await db.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM notifications WHERE created_by = $1 AND idempotency_key = $2',
      [userA, 'concurrent'],
    );
    expect(rows.rows[0].count).toBe(1);
  });
  it('does not persist a send when no targeted devices are active', async () => {
    await devices.deactivate(userB, `web-${suffix}`);
    await expect(
      notifications.create(
        userA,
        'no-devices',
        { type: 'users', userIds: [userB] },
        { title: 'a', body: 'b', data: {} },
      ),
    ).rejects.toThrow(/No active devices/);
    const rows = await db.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM notifications WHERE created_by = $1 AND idempotency_key = $2',
      [userA, 'no-devices'],
    );
    expect(rows.rows[0].count).toBe(0);
  });
  it('records partial success and deactivates only an invalid registration', async () => {
    const good = `good-${suffix}`;
    const bad = `dead-${suffix}`;
    await devices.register(userA, { token: good, platform: 'web' });
    await devices.register(userA, { token: bad, platform: 'web' });
    const created = await notifications.create(
      userA,
      'partial',
      { type: 'platform', platform: 'web' },
      { title: 'a', body: 'b', data: {} },
    );
    const gateway = {
      send: async (_platform: string, tokens: string[]) =>
        tokens.map((token) =>
          token === bad
            ? {
                success: false,
                code: 'messaging/registration-token-not-registered',
              }
            : { success: true, messageId: 'accepted-id' },
        ),
    } as unknown as FirebaseGateway;
    const worker = new NotificationsWorker(notifications, gateway);
    worker.enqueue(created.notification.id);
    let status = '';
    for (let i = 0; i < 100; i++) {
      status = (
        await db.query<{ status: string }>(
          'SELECT status FROM notifications WHERE id = $1',
          [created.notification.id],
        )
      ).rows[0].status;
      if (status !== 'pending' && status !== 'sending') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(status).toBe('partial');
    const rows = await db.query<{ token: string; is_active: boolean }>(
      'SELECT token, is_active FROM device_tokens WHERE token = ANY($1::text[])',
      [[good, bad]],
    );
    expect(rows.rows.find((row) => row.token === bad)?.is_active).toBe(false);
    expect(rows.rows.find((row) => row.token === good)?.is_active).toBe(true);
    const detail = await notifications.detail(created.notification.id);
    expect(JSON.stringify(detail)).not.toContain(good);
    expect(JSON.stringify(detail)).not.toContain(bad);
  });
  it('does not send to a token reassigned after notification creation', async () => {
    const token = `reassigned-${suffix}`;
    await devices.register(userA, { token, platform: 'android' });
    const target = { type: 'users' as const, userIds: [userA] };
    const created = await notifications.create(userA, 'reassigned', target, {
      title: 'a',
      body: 'b',
      data: {},
    });
    await devices.register(userB, { token, platform: 'android' });
    const seen: string[] = [];
    const gateway = {
      send: async (_platform: string, tokens: string[]) => {
        seen.push(...tokens);
        return tokens.map(() => ({ success: true, messageId: 'accepted-id' }));
      },
    } as unknown as FirebaseGateway;
    new NotificationsWorker(notifications, gateway).enqueue(
      created.notification.id,
    );
    for (let i = 0; i < 100; i++) {
      const row = await db.query<{ status: string }>(
        'SELECT status FROM notifications WHERE id = $1',
        [created.notification.id],
      );
      if (!['pending', 'sending'].includes(row.rows[0].status)) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(seen).not.toContain(token);
  });
  it('checks database health and forbids a non-admin on every admin route', async () => {
    // Exercise the compiled Nest application so decorator type metadata matches production.
    const { AppModule } = await import('../dist/app.module.js');
    const { AuthService } = await import('../dist/auth/auth.service.js');
    const { FirebaseGateway: FirebaseProvider } =
      await import('../dist/firebase/firebase.module.js');
    const { APP_CONFIG } = await import('../dist/config/config.module.js');
    const { HttpErrorFilter } = await import('../dist/common/http.js');
    const config = {
      nodeEnv: 'test',
      port: 3000,
      databaseUrl: connectionString!,
      corsOrigins: ['http://localhost:5173'],
      cognitoRegion: 'ap-southeast-2',
      cognitoUserPoolId: 'ap-southeast-2_example',
      cognitoAppClientIds: ['web', 'android'],
      cognitoAdminGroup: 'ADMIN',
      firebaseServiceAccountPath: '/unused',
    };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(config)
      .overrideProvider(FirebaseProvider)
      .useValue({
        send: async (_platform: string, tokens: string[]) =>
          tokens.map(() => ({ success: true, messageId: 'test-accepted' })),
      })
      .overrideProvider(AuthService)
      .useValue({
        verify: async (token: string) => ({
          ...principal('a'),
          role: token === 'admin' ? 'admin' : 'user',
        }),
      })
      .compile();
    const app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new HttpErrorFilter());
    await app.init();
    try {
      const health = await request(app.getHttpServer())
        .get('/health')
        .expect(200);
      expect(health.body).toEqual({ status: 'ok' });
      expect(health.headers['x-request-id']).toBeTruthy();
      await request(app.getHttpServer()).get('/me').expect(401);
      await request(app.getHttpServer())
        .get('/admin/users')
        .set('Authorization', 'Bearer user')
        .expect(403);
      await request(app.getHttpServer())
        .get('/admin/notifications')
        .set('Authorization', 'Bearer user')
        .expect(403);
      await request(app.getHttpServer())
        .get(`/admin/notifications/${randomUUID()}`)
        .set('Authorization', 'Bearer user')
        .expect(403);
      await request(app.getHttpServer())
        .post('/admin/notifications/preview')
        .set('Authorization', 'Bearer user')
        .send({ target: { type: 'all' } })
        .expect(403);
      await request(app.getHttpServer())
        .post('/admin/notifications')
        .set('Authorization', 'Bearer user')
        .send({})
        .expect(403);
      const target = { type: 'users', userIds: [userA] };
      const preview = await request(app.getHttpServer())
        .post('/admin/notifications/preview')
        .set('Authorization', 'Bearer admin')
        .send({ target })
        .expect(201);
      expect(preview.body.totalDevices).toBeGreaterThan(0);
      const payload = { title: 'HTTP test', body: 'A safe body', target };
      const first = await request(app.getHttpServer())
        .post('/admin/notifications')
        .set('Authorization', 'Bearer admin')
        .set('Idempotency-Key', 'http-test')
        .send(payload)
        .expect(202);
      const replay = await request(app.getHttpServer())
        .post('/admin/notifications')
        .set('Authorization', 'Bearer admin')
        .set('Idempotency-Key', 'http-test')
        .send(payload)
        .expect(200);
      expect(first.body.id).toBe(replay.body.id);
      await request(app.getHttpServer())
        .post('/admin/notifications')
        .set('Authorization', 'Bearer admin')
        .set('Idempotency-Key', 'bad-data')
        .send({ ...payload, data: { googleReserved: 'x' } })
        .expect(422);
      await request(app.getHttpServer())
        .get('/admin/notifications/not-a-uuid')
        .set('Authorization', 'Bearer admin')
        .expect(400);
    } finally {
      await app.close();
    }
  });
  it('keeps no more than 20 active registrations under concurrent requests', async () => {
    await Promise.all(
      Array.from({ length: 21 }, (_, index) =>
        devices.register(userB, {
          token: `cap-${suffix}-${index}`,
          platform: 'android',
        }),
      ),
    );
    const result = await db.query<{ active: number }>(
      'SELECT count(*)::int AS active FROM device_tokens WHERE user_id = $1 AND is_active',
      [userB],
    );
    expect(result.rows[0].active).toBe(20);
  });
  it('finalizes all-success and all-failed deliveries correctly', async () => {
    for (const status of ['sent', 'failed'] as const) {
      const created = await notifications.create(
        userA,
        `final-${status}`,
        { type: 'users', userIds: [userA] },
        { title: 'a', body: 'b', data: {} },
      );
      const work = await notifications.work(created.notification.id);
      await notifications.updateDeliveries(
        work.map((delivery) => ({ id: delivery.id, status, attempts: 1 })),
      );
      await notifications.finish(created.notification.id);
      const result = await db.query<{ status: string }>(
        'SELECT status FROM notifications WHERE id = $1',
        [created.notification.id],
      );
      expect(result.rows[0].status).toBe(
        status === 'sent' ? 'completed' : 'failed',
      );
    }
  });
  it('can register devices while resolving recipients without deadlocking', async () => {
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        Promise.all([
          devices.register(userA, {
            token: `racing-${suffix}-${index}`,
            platform: 'android',
          }),
          notifications.create(
            userA,
            `racing-${index}`,
            { type: 'users', userIds: [userA] },
            { title: 'a', body: 'b', data: {} },
          ),
        ]),
      ),
    );
  });
});
