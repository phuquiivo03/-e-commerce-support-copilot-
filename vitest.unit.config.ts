import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/web/tests/unit/**/*.test.ts', 'packages/shared/tests/**/*.test.ts'],
    name: 'unit',
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': new URL('./apps/web/src', import.meta.url).pathname,
      '@copilot/shared': new URL('./packages/shared/src', import.meta.url).pathname,
    },
  },
});
