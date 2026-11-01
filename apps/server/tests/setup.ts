/**
 * Dummy credentials so config/env.ts validates before any test module runs.
 * Tests never connect to Supabase or Postgres — Supabase calls are mocked and
 * the app under test does not touch the pool.
 */
import "./helpers/mock-supabase";

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "error";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:54320/postgres";
process.env.SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.SUPABASE_ANON_KEY ??= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
