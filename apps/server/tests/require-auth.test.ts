import type { Request, Response } from "express";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockQuery, resetSupabaseMocks, supabaseMocks } from "./helpers/mock-state";
import { requireAuth } from "../src/middleware/require-auth";

function mockReq(options: { headers?: Record<string, string>; cookies?: Record<string, string> } = {}): Request {
  return { headers: { ...options.headers }, cookies: { ...options.cookies } } as unknown as Request;
}

async function runMiddleware(req: Request): Promise<Mock> {
  const next = vi.fn();
  await requireAuth(req, {} as unknown as Response, next);
  return next;
}

beforeEach(() => resetSupabaseMocks());

describe("requireAuth", () => {
  it("rejects with 401 UNAUTHENTICATED when no token is present", async () => {
    const next = await runMiddleware(mockReq());

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 401, code: "UNAUTHENTICATED" }));
  });

  it("rejects with 401 when the token fails Supabase verification", async () => {
    supabaseMocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: "Invalid token" } });

    const next = await runMiddleware(mockReq({ headers: { authorization: "Bearer expired-token" } }));

    expect(supabaseMocks.getUser).toHaveBeenCalledWith("expired-token");
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 401, code: "UNAUTHENTICATED" }));
  });

  it("rejects with 401 when the profile row is missing", async () => {
    supabaseMocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    supabaseMocks.from.mockImplementation((table: string) =>
      table === "profiles" ? mockQuery({ data: null, error: { code: "PGRST116" } }) : mockQuery({ data: null, error: null }),
    );

    const next = await runMiddleware(mockReq({ headers: { authorization: "Bearer good-token" } }));

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 401, code: "UNAUTHENTICATED" }));
  });

  it("rejects a profile with an unknown role as 500 INVALID_PROFILE", async () => {
    supabaseMocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    supabaseMocks.from.mockImplementation((table: string) =>
      table === "profiles"
        ? mockQuery({ data: { id: "user-1", email: "x@example.com", role: "SUPERUSER" }, error: null })
        : mockQuery({ data: null, error: null }),
    );

    const next = await runMiddleware(mockReq({ headers: { authorization: "Bearer good-token" } }));

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 500, code: "INVALID_PROFILE" }));
  });

  it("attaches the profile role (never client claims) for staff", async () => {
    supabaseMocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    supabaseMocks.from.mockImplementation((table: string) =>
      table === "profiles"
        ? mockQuery({ data: { id: "user-1", email: "agent@example.com", role: "SUPPORT_AGENT" }, error: null })
        : mockQuery({ data: null, error: null }),
    );

    const req = mockReq({ headers: { authorization: "Bearer good-token" } });
    const next = await runMiddleware(req);

    expect(next).toHaveBeenCalledWith();
    expect(req.auth).toEqual({ userId: "user-1", email: "agent@example.com", role: "SUPPORT_AGENT" });
  });

  it("resolves customerId from the customers table for CUSTOMER role", async () => {
    supabaseMocks.getUser.mockResolvedValue({ data: { user: { id: "user-2" } }, error: null });
    supabaseMocks.from.mockImplementation((table: string) =>
      table === "profiles"
        ? mockQuery({ data: { id: "user-2", email: "cust@example.com", role: "CUSTOMER" }, error: null })
        : mockQuery({ data: { profile_id: "user-2" }, error: null }),
    );

    const req = mockReq({ headers: { authorization: "Bearer good-token" } });
    await runMiddleware(req);

    expect(req.auth).toEqual({
      userId: "user-2",
      email: "cust@example.com",
      role: "CUSTOMER",
      customerId: "user-2",
    });
  });

  it("leaves customerId unset for staff roles", async () => {
    supabaseMocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    supabaseMocks.from.mockImplementation((table: string) =>
      table === "profiles"
        ? mockQuery({ data: { id: "user-1", email: "admin@example.com", role: "ADMIN" }, error: null })
        : mockQuery({ data: { profile_id: "user-1" }, error: null }),
    );

    const req = mockReq({ headers: { authorization: "Bearer good-token" } });
    await runMiddleware(req);

    expect(req.auth).toEqual({ userId: "user-1", email: "admin@example.com", role: "ADMIN" });
  });

  it("reads the token from the classic Supabase auth cookie", async () => {
    supabaseMocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    supabaseMocks.from.mockImplementation((table: string) =>
      table === "profiles"
        ? mockQuery({ data: { id: "user-1", email: "a@example.com", role: "ADMIN" }, error: null })
        : mockQuery({ data: null, error: null }),
    );

    await runMiddleware(mockReq({ cookies: { "sb-access-token": "cookie-token" } }));

    expect(supabaseMocks.getUser).toHaveBeenCalledWith("cookie-token");
  });

  it("reads the token from a plain @supabase/ssr session cookie", async () => {
    supabaseMocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    supabaseMocks.from.mockImplementation((table: string) =>
      table === "profiles"
        ? mockQuery({ data: { id: "user-1", email: "a@example.com", role: "ADMIN" }, error: null })
        : mockQuery({ data: null, error: null }),
    );

    await runMiddleware(
      mockReq({ cookies: { "sb-projectref-auth-token": JSON.stringify({ access_token: "ssr-token" }) } }),
    );

    expect(supabaseMocks.getUser).toHaveBeenCalledWith("ssr-token");
  });

  it("reads the token from a chunked, base64-encoded @supabase/ssr cookie", async () => {
    supabaseMocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    supabaseMocks.from.mockImplementation((table: string) =>
      table === "profiles"
        ? mockQuery({ data: { id: "user-1", email: "a@example.com", role: "ADMIN" }, error: null })
        : mockQuery({ data: null, error: null }),
    );

    const encoded = `base64-${Buffer.from(JSON.stringify({ access_token: "chunked-token" })).toString("base64")}`;
    const mid = Math.ceil(encoded.length / 2);
    const req = mockReq({
      cookies: {
        "sb-projectref-auth-token.0": encoded.slice(0, mid),
        "sb-projectref-auth-token.1": encoded.slice(mid),
      },
    });
    await runMiddleware(req);

    expect(supabaseMocks.getUser).toHaveBeenCalledWith("chunked-token");
    expect(req.auth).toEqual({ userId: "user-1", email: "a@example.com", role: "ADMIN" });
  });

  it("ignores a malformed session cookie and rejects with 401", async () => {
    const next = await runMiddleware(
      mockReq({ cookies: { "sb-projectref-auth-token": "not-json-at-all" } }),
    );

    expect(supabaseMocks.getUser).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 401, code: "UNAUTHENTICATED" }));
  });
});
