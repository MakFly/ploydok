// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test";
import { app } from "./app";

describe("global request logger + error handler", () => {
  it("injecte un x-request-id et retourne 200 sur /health", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("respecte un x-request-id entrant", async () => {
    const res = await app.request("/health", {
      headers: { "x-request-id": "trace-abc-123" },
    });
    expect(res.headers.get("x-request-id")).toBe("trace-abc-123");
  });

  it("rejette un x-request-id entrant trop long (>64) et en génère un nouveau", async () => {
    const tooLong = "a".repeat(65);
    const res = await app.request("/health", { headers: { "x-request-id": tooLong } });
    const got = res.headers.get("x-request-id");
    expect(got).toBeTruthy();
    expect(got).not.toBe(tooLong);
  });

  it("capture une exception non typée en 500 avec JSON { error }", async () => {
    const res = await app.request("/__test/throw");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string; req_id: string } };
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.req_id).toBeTruthy();
  });

  it("respecte le status d'une HTTPException Hono", async () => {
    const res = await app.request("/__test/http-exception");
    expect(res.status).toBe(418);
    const body = (await res.json()) as { error: { code: string; message: string; req_id: string } };
    expect(body.error.code).toBe("HTTP_EXCEPTION");
    expect(body.error.message).toBe("I'm a teapot");
  });

  it("retourne 404 JSON { error: NOT_FOUND } sur route inconnue", async () => {
    const res = await app.request("/ce-chemin-nexiste-pas");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; req_id: string } };
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.req_id).toBeTruthy();
  });
});
