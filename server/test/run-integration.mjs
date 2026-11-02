import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

if (process.argv[2]) process.loadEnvFile(resolve(process.argv[2]));
if (
  !process.env.TEST_DATABASE_URL &&
  process.env.POSTGRES_USER &&
  process.env.POSTGRES_PASSWORD &&
  process.env.POSTGRES_DB
) {
  process.env.TEST_DATABASE_URL = `postgresql://${encodeURIComponent(process.env.POSTGRES_USER)}:${encodeURIComponent(process.env.POSTGRES_PASSWORD)}@127.0.0.1:${process.env.POSTGRES_PORT || '5432'}/${process.env.POSTGRES_DB}`;
}
if (!process.env.TEST_DATABASE_URL)
  throw new Error('Set TEST_DATABASE_URL or pass an isolated Docker env file');
const env = { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL };
execFileSync(process.execPath, ['dist/database/migrate.js'], {
  env,
  stdio: 'inherit',
});
execFileSync(process.execPath, ['dist/database/migrate.js'], {
  env,
  stdio: 'inherit',
});
execFileSync(
  process.execPath,
  ['node_modules/vitest/vitest.mjs', 'run', 'test/integration.test.ts'],
  { env, stdio: 'inherit' },
);
