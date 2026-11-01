import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { mockQuery, resetSupabaseMocks, supabaseMocks } from "./helpers/mock-state";
import { createApp } from "../src/app";
import { AUTH_COOKIE } from "../src/modules/auth/auth.routes";

const validLogin = { email: "agent@example.com", password: "password123" };

const agentProfile = {
  id: "user-1",
  email: "agent@example.com",
  full_name: "Support Agent",
  role: "SUPPORT_AGENT",
};

const supabaseSession = {
  access_token: "access-1",
  refresh_token: "refresh-1",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 1_700_000_000,
};

function mockStaffProfile() {
  supabaseMocks.from.mockImplementation((table: string) =>
    table === "profiles" ? mockQuery({ data: agentProfile, error: null }) : mockQuery({ data: null, error: null }),
  );
}

/** supertest types set-cookie loosely; at runtime it is always a string[]. */
function setCookies(res: { headers: Record<string, unknown> }): string[] {
  return (res.headers["set-cookie"] ?? []) as string[];
}

beforeEach(() => resetSupabaseMocks());

describe("POST /api/v1/auth/login", () => {
  it("returns session + user and sets an httpOnly session cookie", async () => {
    supabaseMocks.signInWithPassword.mockResolvedValue({
      data: { user: { id: agentProfile.id }, session: supabaseSession },
      error: null,
    });
    mockStaffProfile();

    const res = await request(createApp()).post("/api/v1/auth/login").send(validLogin);

    expect(res.status).toBe(200);
    expect(supabaseMocks.signInWithPassword).toHaveBeenCalledWith(validLogin);
    expect(res.body.data.user).toEqual({
      id: "user-1",
      email: "agent@example.com",
      fullName: "Support Agent",
      role: "SUPPORT_AGENT",
    });
    expect(res.body.data.session).toEqual({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      tokenType: "bearer",
      expiresIn: 3600,
      expiresAt: 1_700_000_000,
    });
    const cookie = setCookies(res).find((c) => c.startsWith(`${AUTH_COOKIE}=`));
    expect(cookie).toContain(`${AUTH_COOKIE}=access-1`);
    expect(cookie).toContain("HttpOnly");
  });

  it("returns a 401 error envelope on invalid credentials", async () => {
    supabaseMocks.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Invalid login credentials" },
    });

    const res = await request(createApp()).post("/api/v1/auth/login").send(validLogin);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: "INVALID_CREDENTIALS", message: "Invalid email or password." });
  });

  it("returns 422 VALIDATION_ERROR for a malformed body", async () => {
    const res = await request(createApp())
      .post("/api/v1/auth/login")
      .send({ email: "not-an-email", password: "short" });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /api/v1/auth/logout", () => {
  it("revokes the session server-side and clears the cookie", async () => {
    const res = await request(createApp())
      .post("/api/v1/auth/logout")
      .set("Authorization", "Bearer access-1")
      .send({});

    expect(res.status).toBe(204);
    expect(supabaseMocks.adminSignOut).toHaveBeenCalledWith("access-1");
    const cookie = setCookies(res)[0];
    expect(cookie).toContain(`${AUTH_COOKIE}=;`);
  });

  it("still clears the cookie when no token is provided", async () => {
    const res = await request(createApp()).post("/api/v1/auth/logout").send({});

    expect(res.status).toBe(204);
    expect(supabaseMocks.adminSignOut).not.toHaveBeenCalled();
    expect(setCookies(res)[0]).toContain(`${AUTH_COOKIE}=;`);
  });
});

describe("GET /api/v1/auth/me", () => {
  it("rejects with 401 when no token is present", async () => {
    const res = await request(createApp()).get("/api/v1/auth/me");

    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("returns the verified auth context for a bearer token", async () => {
    supabaseMocks.getUser.mockResolvedValue({ data: { user: { id: agentProfile.id } }, error: null });
    mockStaffProfile();

    const res = await request(createApp()).get("/api/v1/auth/me").set("Authorization", "Bearer access-1");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      user: { userId: "user-1", email: "agent@example.com", role: "SUPPORT_AGENT" },
    });
  });

  it("accepts the session cookie set by login", async () => {
    supabaseMocks.signInWithPassword.mockResolvedValue({
      data: { user: { id: agentProfile.id }, session: supabaseSession },
      error: null,
    });
    supabaseMocks.getUser.mockResolvedValue({ data: { user: { id: agentProfile.id } }, error: null });
    mockStaffProfile();
    const agent = request.agent(createApp());

    const loginRes = await agent.post("/api/v1/auth/login").send(validLogin);
    const res = await agent.get("/api/v1/auth/me");

    expect(loginRes.status).toBe(200);
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ userId: "user-1", role: "SUPPORT_AGENT" });
  });
});
