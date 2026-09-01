/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';

// Opt-in integration and conformance tests. Not run by `npm test`; see
// test/integration/README.md. Each spec skips cleanly when its tools or
// fixtures are absent.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/integration/**/*.itest.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    pool: 'forks',
    // External subprocesses (rasm, pasmo, mame) — keep the run deterministic.
    fileParallelism: false,
  },
});
