/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  // The playground is a static site; Wrangler serves the built ./dist.
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
  test: {
    globals: true,
    // The emulator core is DOM-free, so tests run in plain Node.
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
