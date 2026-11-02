import { configDefaults, defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode, command }) => {
  if (command === 'build') {
    const env = loadEnv(mode, process.cwd(), 'VITE_');
    const required = [
      'VITE_COGNITO_REGION',
      'VITE_COGNITO_USER_POOL_ID',
      'VITE_COGNITO_CLIENT_ID',
    ];
    const missing = required.filter((key) => !env[key]?.trim());
    if (missing.length) {
      throw new Error(
        `Missing website configuration: ${missing.join(', ')}. Add these environment variables before deploying.`,
      );
    }
    if (
      !env.VITE_COGNITO_USER_POOL_ID.startsWith(`${env.VITE_COGNITO_REGION}_`)
    ) {
      throw new Error(
        'Website Cognito user pool must belong to VITE_COGNITO_REGION.',
      );
    }
  }
  return {
    plugins: [react()],
    server: {
      proxy: {
        '^/api(?:/|$)': {
          target:
            loadEnv(mode, process.cwd(), 'DEV_API_PROXY_TARGET')
              .DEV_API_PROXY_TARGET || 'http://127.0.0.1:3000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api(?=\/|$)/, '') || '/',
        },
      },
    },
    test: { exclude: [...configDefaults.exclude, 'e2e/**'] },
  };
});
