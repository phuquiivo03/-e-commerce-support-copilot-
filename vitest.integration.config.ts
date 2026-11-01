import { defineConfig } from 'vitest/config';

/**
 * Integration tests require the local Supabase stack (migrations + seed
 * applied) and take DATABASE_URL / SUPABASE_*_KEY from apps/web/.env.local.
 * Run with: npm run test:integration
 */
export default defineConfig({
  test: {
    include: ['apps/web/tests/integration/**/*.test.ts'],
    name: 'integration',
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    maxConcurrency: 1,
    sequence: { concurrent: false },
  },
  resolve: {
    alias: {
      '@': new URL('./apps/web/src', import.meta.url).pathname,
      '@copilot/shared': new URL('./packages/shared/src', import.meta.url).pathname,
    },
  },
});
