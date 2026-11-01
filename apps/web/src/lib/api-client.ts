'use client';

/** Typed fetch for the { data } / { error } API envelope. */
export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
    credentials: 'same-origin',
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON error page — fall through to status handling.
  }

  if (!response.ok) {
    const err = (payload as { error?: { code?: string; message?: string; details?: unknown } })?.error;
    throw new ApiClientError(
      response.status,
      err?.code ?? 'REQUEST_FAILED',
      err?.message ?? `Request failed with status ${response.status}`,
      err?.details
    );
  }

  return (payload as { data: T }).data;
}
