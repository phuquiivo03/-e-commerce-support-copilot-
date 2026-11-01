import { vi } from "vitest";

/** Shared Supabase stubs — the very instances the module mock hands out and test files configure. */
export const supabaseMocks = {
  getUser: vi.fn(),
  signInWithPassword: vi.fn(),
  adminSignOut: vi.fn(),
  from: vi.fn(),
};

export function resetSupabaseMocks(): void {
  for (const mock of Object.values(supabaseMocks)) mock.mockReset();
  // Safe defaults: an unmocked call fails loudly instead of hitting the network.
  supabaseMocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: "not mocked" } });
  supabaseMocks.signInWithPassword.mockResolvedValue({
    data: { user: null, session: null },
    error: { message: "not mocked" },
  });
  supabaseMocks.adminSignOut.mockResolvedValue({ error: null });
  supabaseMocks.from.mockImplementation((table: string) => {
    throw new Error(`supabase.from("${table}") not mocked for this test`);
  });
}

/** PostgREST query-builder stub: every terminal call resolves with `result`. */
export function mockQuery(result: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    single: vi.fn(async () => result),
    maybeSingle: vi.fn(async () => result),
  };
  return chain;
}
