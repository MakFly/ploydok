// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { app } from "./app";

// e2e: démarre un vrai Bun.serve sur un port aléatoire et envoie des requêtes HTTP.
let server: ReturnType<typeof Bun.serve>;
let baseUrl = "";

beforeAll(() => {
  server = Bun.serve({ port: 0, fetch: app.fetch });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

describe("HTTP e2e", () => {
  it("GET /health répond 200 et inclut x-request-id", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBeTruthy();
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("GET /auth/csrf pose un cookie csrf + retourne le token", async () => {
    const res = await fetch(`${baseUrl}/auth/csrf`);
    expect(res.status).toBe(200);

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("csrf=");
    expect(setCookie).toContain("SameSite=Lax");

    const body = (await res.json()) as { token: string };
    expect(body.token).toMatch(/^[0-9a-f-]{36}$/);

    // Le cookie et le token doivent correspondre (double-submit).
    const cookieToken = /csrf=([^;]+)/.exec(setCookie)?.[1];
    expect(cookieToken).toBe(body.token);
  });

  it("POST sans CSRF est rejeté 403", async () => {
    const res = await fetch(`${baseUrl}/auth/logout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CSRF_MISMATCH");
  });

  it("POST avec CSRF valide passe la validation CSRF (ne retourne pas 403)", async () => {
    const csrfRes = await fetch(`${baseUrl}/auth/csrf`);
    const { token } = (await csrfRes.json()) as { token: string };
    const cookie = (csrfRes.headers.get("set-cookie") ?? "").split(";")[0];

    const res = await fetch(`${baseUrl}/auth/logout`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": token,
        cookie: cookie ?? "",
      },
    });
    expect(res.status).not.toBe(403);
  });

  it("route inconnue retourne 404 JSON", async () => {
    const res = await fetch(`${baseUrl}/nope`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("exception non capturée retourne 500 JSON (test route)", async () => {
    const res = await fetch(`${baseUrl}/__test/throw`);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; req_id: string } };
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.req_id).toBeTruthy();
  });
});
