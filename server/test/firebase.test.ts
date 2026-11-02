import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FirebaseGateway } from '../src/firebase/firebase.module.js';
import type { AppConfig } from '../src/config/config.module.js';

describe('Firebase Admin initialization', () => {
  it('rejects a missing service account without exposing its contents', () => {
    const config = {
      firebaseServiceAccountPath: '/no-such-service-account.json',
    } as AppConfig;
    expect(() => new FirebaseGateway(config)).toThrow(/missing or invalid/);
  });
  it('loads a valid local service-account file without contacting FCM', async () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'notification-firebase-test-'),
    );
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const path = join(directory, 'service-account.json');
    writeFileSync(
      path,
      JSON.stringify({
        type: 'service_account',
        project_id: 'local-test-only',
        client_email: 'test@local-test-only.iam.gserviceaccount.com',
        private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      }),
      { mode: 0o600 },
    );
    try {
      const gateway = new FirebaseGateway({
        firebaseServiceAccountPath: path,
      } as AppConfig);
      await gateway.onModuleDestroy();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
