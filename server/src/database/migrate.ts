import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';

async function migrate(): Promise<void> {
  if (!process.env.DATABASE_URL)
    throw new Error('DATABASE_URL is required to run migrations');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    // A dedicated session lock prevents concurrent runners from applying a file twice.
    await client.query(
      "SELECT pg_advisory_lock(hashtext('notifications_migrations'))",
    );
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const directory = resolve(process.cwd(), 'migrations');
    const files = (await readdir(directory))
      .filter((file) => /^\d+_[a-z0-9_]+\.sql$/.test(file))
      .sort();
    const existing = await client.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations',
    );
    const applied = new Set(existing.rows.map((row) => row.filename));
    for (const filename of files) {
      if (applied.has(filename)) continue;
      const sql = await readFile(resolve(directory, filename), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [filename],
        );
        await client.query('COMMIT');
        console.log(`Applied ${filename}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.query(
      "SELECT pg_advisory_unlock(hashtext('notifications_migrations'))",
    );
    client.release();
    await pool.end();
  }
}
void migrate().catch(() => {
  console.error(
    'Migration failed. Check the database connection and migration files.',
  );
  process.exitCode = 1;
});
