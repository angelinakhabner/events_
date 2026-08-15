import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // The e2e page tests route tRPC through the real Hono app in-process, and
    // the invite gate (GOI-83) defaults ON — which would deny every one of
    // them. They are testing the app, not the gate; the gate has its own
    // suites on both sides. This is also the "local dev works without a
    // token" path.
    env: { INVITE_GATE_ENABLED: 'false' },
  },
  resolve: {
    alias: {
      '@afisz/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
});
