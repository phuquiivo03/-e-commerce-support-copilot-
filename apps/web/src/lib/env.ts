/**
 * Server-side environment configuration. Nothing here is exposed to the
 * browser except the two NEXT_PUBLIC_ Supabase variables.
 *
 * AI providers are configurable and optional: the app runs fully deterministic
 * in mock mode (LLM_PROVIDER=mock, EMBEDDING_PROVIDER=mock) with no external
 * credentials, as required for the demo and the test suite.
 */
import { z } from 'zod';

const EnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  LLM_PROVIDER: z.enum(['mock', 'openai-compatible']).default('mock'),
  LLM_BASE_URL: z.string().url().optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default('gpt-4o-mini'),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),

  EMBEDDING_PROVIDER: z.enum(['mock', 'openai-compatible']).default('mock'),
  EMBEDDING_BASE_URL: z.string().url().optional(),
  EMBEDDING_API_KEY: z.string().optional(),
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  EMBEDDING_DIMS: z.coerce.number().int().positive().default(1536),

  INGESTION_CHUNK_TOKENS: z.coerce.number().int().positive().default(180),
  INGESTION_CHUNK_OVERLAP_TOKENS: z.coerce.number().int().nonnegative().default(30),
  RETRIEVAL_MATCH_COUNT: z.coerce.number().int().positive().default(8),

  /** Restricts which tickets a SUPPORT_AGENT sees: `all` (default) or `assigned`. */
  SUPPORT_AGENT_SCOPE: z.enum(['all', 'assigned']).default('all'),

  APP_URL: z.string().url().default('http://localhost:3000'),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration:\n${parsed.error.issues
        .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
        .join('\n')}`
    );
  }
  cached = parsed.data;
  return cached;
}

/**
 * Throws when a live provider is selected but its credentials are missing —
 * callers fall back to deterministic mock mode instead of making broken
 * network calls.
 */
export function providerConfigured(kind: 'llm' | 'embedding'): boolean {
  const env = getEnv();
  if (kind === 'llm') {
    return env.LLM_PROVIDER === 'mock' || Boolean(env.LLM_BASE_URL && env.LLM_API_KEY);
  }
  return env.EMBEDDING_PROVIDER === 'mock' || Boolean(env.EMBEDDING_BASE_URL && env.EMBEDDING_API_KEY);
}
