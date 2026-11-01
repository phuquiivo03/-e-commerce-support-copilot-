import type { AuthContext } from "@copilot/shared";
import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetSupabaseMocks } from "./helpers/mock-state";
import { requireRole } from "../src/middleware/require-role";

const asCustomer: AuthContext = { userId: "uuid-1", email: "c@example.com", role: "CUSTOMER" };
const asAgent: AuthContext = { userId: "uuid-2", email: "a@example.com", role: "SUPPORT_AGENT" };
const asAdmin: AuthContext = { userId: "uuid-3", email: "admin@example.com", role: "ADMIN" };

function reqWith(auth: AuthContext | undefined): Request {
  return { auth } as unknown as Request;
}

beforeEach(() => resetSupabaseMocks());

describe("requireRole", () => {
  it("rejects with 401 UNAUTHENTICATED when requireAuth has not run", () => {
    const next = vi.fn();

    requireRole("ADMIN")(reqWith(undefined), {} as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 401, code: "UNAUTHENTICATED" }));
  });

  it("rejects with 403 FORBIDDEN when the role is not in the allowlist", () => {
    const next = vi.fn();

    requireRole("ADMIN", "SUPPORT_AGENT")(reqWith(asCustomer), {} as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 403, code: "FORBIDDEN" }));
  });

  it("calls next() without an error for an allowed role", () => {
    const next = vi.fn();

    requireRole("SUPPORT_AGENT")(reqWith(asAgent), {} as unknown as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it("allows any of the listed roles", () => {
    const middleware = requireRole("ADMIN", "SUPPORT_AGENT", "CUSTOMER");

    for (const req of [reqWith(asAdmin), reqWith(asAgent), reqWith(asCustomer)]) {
      const next = vi.fn();
      middleware(req, {} as unknown as Response, next);
      expect(next).toHaveBeenCalledWith();
    }
  });
});
