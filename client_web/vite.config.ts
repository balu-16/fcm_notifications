import { configDefaults, defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    proxy: {
      '^/api(?:/|$)': {
        target: loadEnv(mode, process.cwd(), 'DEV_API_PROXY_TARGET').DEV_API_PROXY_TARGET || 'http://127.0.0.1:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api(?=\/|$)/, '') || '/',
      },
    },
  },
  test: { exclude: [...configDefaults.exclude, 'e2e/**'] },
}));
