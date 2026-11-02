import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const chrome =
  process.env.CHROME_PATH ||
  (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);
export default defineConfig({
  testDir: './e2e',
  outputDir: '/tmp/notifications-playwright-results',
  use: {
    baseURL: 'http://127.0.0.1:5178',
    browserName: 'chromium',
    launchOptions: { executablePath: chrome },
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5178 --strictPort',
    url: 'http://127.0.0.1:5178',
    timeout: 60_000,
  },
});
