/**
 * LLM provider adapter for structured generation.
 *
 * - `openai-compatible`: chat completions with JSON output, validated with the
 *   provided Zod schema. Transient failures (429/5xx/network) are retried
 *   once; timeouts abort; malformed outputs raise TypedOutputError.
 * - There is deliberately no "mock LLM": when LLM_PROVIDER=mock (or the
 *   provider fails), the copilot falls back to the deterministic template
 *   composer, which answers from retrieved evidence and database facts only.
 */
import type { z } from 'zod';
import { getEnv, providerConfigured } from '@/lib/env';

export class TypedOutputError extends Error {
  constructor(message: string, readonly raw?: string) {
    super(message);
  }
}

export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export interface LlmAdapter {
  readonly name: string;
  readonly model: string;
  /** Generates a JSON object validated against `schema`. */
  generateJson<T extends z.ZodType>(input: {
    system: string;
    user: string;
    schema: T;
    schemaName: string;
    maxTokens?: number;
  }): Promise<z.infer<T>>;
}

export function llmEnabled(): boolean {
  return getEnv().LLM_PROVIDER === 'openai-compatible' && providerConfigured('llm');
}

export function getLlmAdapter(): LlmAdapter {
  const env = getEnv();
  if (!llmEnabled()) {
    throw new ProviderUnavailableError('LLM provider is not configured (mock mode).');
  }
  return new OpenAICompatibleLlmAdapter(env.LLM_BASE_URL!, env.LLM_API_KEY!, env.LLM_MODEL, env.LLM_TIMEOUT_MS);
}

export class OpenAICompatibleLlmAdapter implements LlmAdapter {
  readonly name = 'openai-compatible';

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    readonly model: string,
    private readonly timeoutMs: number
  ) {}

  async generateJson<T extends z.ZodType>(input: {
    system: string;
    user: string;
    schema: T;
    schemaName: string;
    maxTokens?: number;
  }): Promise<z.infer<T>> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await this.chatCompletion(input);
        return validateStructuredOutput(raw, input.schema, input.schemaName);
      } catch (error) {
        lastError = error;
        const transient =
          error instanceof ProviderUnavailableError ||
          (error instanceof TypedOutputError && !(error instanceof SyntaxError));
        if (!transient || attempt === 1) break;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async chatCompletion(input: {
    system: string;
    user: string;
    schemaName: string;
    maxTokens?: number;
  }): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: input.system },
            { role: 'user', content: input.user },
          ],
          response_format: { type: 'json_object' },
          temperature: 0,
          max_tokens: input.maxTokens ?? 900,
        }),
        signal: controller.signal,
      });

      if (response.status === 429 || response.status >= 500) {
        throw new ProviderUnavailableError(`Provider responded ${response.status}`);
      }
      if (!response.ok) {
        const body = await response.text();
        throw new TypedOutputError(`Provider responded ${response.status}: ${body.slice(0, 200)}`);
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) {
        throw new TypedOutputError('Provider returned an empty completion.');
      }
      return content;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ProviderUnavailableError(`Provider timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function validateStructuredOutput<T extends z.ZodType>(
  raw: string,
  schema: T,
  schemaName: string
): z.infer<T> {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new TypedOutputError(`Provider output was not valid JSON for ${schemaName}.`, raw.slice(0, 400));
  }
  const parsed = schema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new TypedOutputError(
      `Provider output failed ${schemaName} validation: ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
      raw.slice(0, 400)
    );
  }
  return parsed.data;
}
