import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";

describe("GET /health", () => {
  it("returns 200 with the ok envelope", async () => {
    const app = createApp();

    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ data: { status: "ok" } });
    expect(typeof res.body.data.uptimeSeconds).toBe("number");
  });

  it("echoes the caller's x-request-id as correlation id", async () => {
    const app = createApp();

    const res = await request(app).get("/health").set("x-request-id", "test-correlation-id");

    expect(res.headers["x-request-id"]).toBe("test-correlation-id");
  });

  it("mints a correlation id when none is provided", async () => {
    const app = createApp();

    const res = await request(app).get("/health");

    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("answers unknown routes with the JSON error envelope, not HTML", async () => {
    const app = createApp();

    const res = await request(app).get("/nope");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: "NOT_FOUND" });
  });
});
