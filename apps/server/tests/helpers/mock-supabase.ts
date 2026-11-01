import { vi } from "vitest";

/**
 * Registers the @supabase/supabase-js mock. Imported by tests/setup.ts so the
 * mock applies before any test module (and therefore the app) is imported.
 * The factory imports ./mock-state lazily so the stubs test files configure
 * are the same instances the mocked createClient hands out.
 */
vi.mock("@supabase/supabase-js", async () => {
  const { supabaseMocks } = await import("./mock-state");
  return {
    createClient: () => ({
      auth: {
        getUser: supabaseMocks.getUser,
        signInWithPassword: supabaseMocks.signInWithPassword,
        admin: { signOut: supabaseMocks.adminSignOut },
      },
      from: supabaseMocks.from,
    }),
  };
});
