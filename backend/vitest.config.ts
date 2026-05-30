import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/__tests__/**'],
    },
  },
  resolve: {
    alias: {
      '@goin/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
});
