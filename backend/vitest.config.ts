import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Integration tests share one Postgres in CI, and scraper.test.ts
    // TRUNCATEs events/scrape_runs between cases — parallel test files racing
    // that truncation flake (e.g. a fixture event vanishing mid-test). Run
    // files sequentially; the suite is small enough that this costs seconds.
    fileParallelism: false,
    // The invite gate (GOI-83) defaults ON, which would deny every request in
    // suites that predate it and are testing something else entirely. Tests
    // run with it off; invite-gate's own suite turns it on explicitly, which
    // is also the "local dev works without a token" path.
    env: { INVITE_GATE_ENABLED: 'false' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/__tests__/**'],
    },
  },
  resolve: {
    alias: {
      '@afisz/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
});
