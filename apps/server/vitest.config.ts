import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    name: 'server',
    environment: 'node',
    // Provides dummy credentials before any module (config/env.ts) reads them.
    setupFiles: ['tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@copilot/shared': fileURLToPath(new URL('../../packages/shared/src', import.meta.url)),
    },
  },
});
