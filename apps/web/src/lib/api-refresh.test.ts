// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from "bun:test";
import { ApiError, apiFetch, invalidateGetCache, resetCsrfToken } from "./api";

const BASE = "http://localhost:4000";

interface Call {
  url: string;
  init?: RequestInit;
}

let calls: Array<Call> = [];
let queue: Map<string, Array<{ status: number; body: unknown }>>;

function enqueue(url: string, responses: Array<{ status: number; body: unknown }>): void {
  queue.set(url, responses);
}

function setup(): void {
  calls = [];
  queue = new Map();
  resetCsrfToken();
  invalidateGetCache();
  (global as unknown as { fetch: unknown }).fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    const list = queue.get(url) ?? [];
    const resp = list.shift() ?? { status: 200, body: {} };
    // Défaut CSRF
    if (url === `${BASE}/auth/csrf` && list.length === 0 && resp.status === 200 && !resp.body) {
      return new Response(JSON.stringify({ token: "t" }), { status: 200 });
    }
    return new Response(JSON.stringify(resp.body), { status: resp.status });
  };
}

describe("apiFetch — auto-refresh sur 401", () => {
  beforeEach(setup);

  it("retente après un refresh réussi et renvoie la 2ᵉ réponse", async () => {
    enqueue(`${BASE}/auth/csrf`, [{ status: 200, body: { token: "t" } }]);
    enqueue(`${BASE}/me`, [
      { status: 401, body: { error: { code: "UNAUTHENTICATED", message: "expired" } } },
      { status: 200, body: { user: { id: "u1" } } },
    ]);
    enqueue(`${BASE}/auth/refresh`, [{ status: 200, body: {} }]);

    const data = await apiFetch<{ user: { id: string } }>("/me");
    expect(data.user.id).toBe("u1");

    const urls = calls.map((c) => c.url);
    expect(urls).toContain(`${BASE}/me`);
    expect(urls).toContain(`${BASE}/auth/refresh`);
    // /me appelé deux fois (initial + retry après refresh)
    expect(urls.filter((u) => u === `${BASE}/me`).length).toBe(2);
  });

  it("propage l'ApiError 401 si le refresh échoue", async () => {
    enqueue(`${BASE}/auth/csrf`, [{ status: 200, body: { token: "t" } }]);
    enqueue(`${BASE}/me`, [
      { status: 401, body: { error: { code: "UNAUTHENTICATED", message: "expired" } } },
    ]);
    enqueue(`${BASE}/auth/refresh`, [{ status: 401, body: { error: { code: "INVALID_REFRESH" } } }]);

    await expect(apiFetch("/me")).rejects.toBeInstanceOf(ApiError);
  });

  it("déduplique les GET concurrents vers le même path (cache 2s)", async () => {
    enqueue(`${BASE}/me`, [{ status: 200, body: { user: { id: "u1" } } }]);

    // 3 appels "concurrents" au même path
    const [a, b, c] = await Promise.all([apiFetch("/me"), apiFetch("/me"), apiFetch("/me")]);
    expect(a).toEqual(b);
    expect(b).toEqual(c);

    // Un seul fetch réseau pour /me
    const meCalls = calls.filter((x) => x.url === `${BASE}/me`).length;
    expect(meCalls).toBe(1);
  });

  it("ne retente pas sur un 401 venant de /auth/*", async () => {
    enqueue(`${BASE}/auth/csrf`, [{ status: 200, body: { token: "t" } }]);
    enqueue(`${BASE}/auth/login/options`, [
      { status: 401, body: { error: { code: "UNAUTHENTICATED" } } },
    ]);

    await expect(apiFetch("/auth/login/options")).rejects.toBeInstanceOf(ApiError);
    const urls = calls.map((c) => c.url);
    expect(urls.filter((u) => u.includes("/auth/refresh")).length).toBe(0);
  });
});
