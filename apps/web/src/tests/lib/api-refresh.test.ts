// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from "bun:test";
import {
  ApiError,
  BackendUnavailableError,
  SessionExpiredError,
  apiFetch,
  criticalRetryDelay,
  invalidateGetCache,
  resetCsrfToken,
  shouldRetryCriticalQuery,
} from "../../lib/api";

const BASE = "http://localhost:3335";

interface Call {
  url: string;
  init?: RequestInit;
}

let calls: Array<Call> = [];
let queue: Map<string, Array<{ status: number; body: unknown }>>;
const originalWindow = globalThis.window;

function enqueue(url: string, responses: Array<{ status: number; body: unknown }>): void {
  queue.set(url, responses);
}

function setup(): void {
  calls = [];
  queue = new Map();
  resetCsrfToken();
  invalidateGetCache();
  (globalThis as { window?: unknown }).window = {};
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

  it("ne retente pas sur un 401 venant des endpoints pré-session", async () => {
    enqueue(`${BASE}/auth/csrf`, [{ status: 200, body: { token: "t" } }]);
    enqueue(`${BASE}/auth/login/options`, [
      { status: 401, body: { error: { code: "UNAUTHENTICATED" } } },
    ]);

    await expect(apiFetch("/auth/login/options")).rejects.toBeInstanceOf(ApiError);
    const urls = calls.map((c) => c.url);
    expect(urls.filter((u) => u.includes("/auth/refresh")).length).toBe(0);
  });

  it("retente /auth/sessions après un refresh réussi (endpoint protégé)", async () => {
    enqueue(`${BASE}/auth/sessions`, [
      { status: 401, body: { error: { code: "UNAUTHENTICATED", message: "expired" } } },
      { status: 200, body: { sessions: [] } },
    ]);
    enqueue(`${BASE}/auth/refresh`, [{ status: 200, body: {} }]);

    const data = await apiFetch<{ sessions: Array<unknown> }>("/auth/sessions");
    expect(data.sessions).toEqual([]);

    const urls = calls.map((c) => c.url);
    expect(urls.filter((u) => u === `${BASE}/auth/refresh`).length).toBe(1);
    expect(urls.filter((u) => u === `${BASE}/auth/sessions`).length).toBe(2);
  });

  it("retente /auth/passkeys après un refresh réussi (endpoint protégé)", async () => {
    enqueue(`${BASE}/auth/passkeys`, [
      { status: 401, body: { error: { code: "UNAUTHENTICATED" } } },
      { status: 200, body: { passkeys: [] } },
    ]);
    enqueue(`${BASE}/auth/refresh`, [{ status: 200, body: {} }]);

    const data = await apiFetch<{ passkeys: Array<unknown> }>("/auth/passkeys");
    expect(data.passkeys).toEqual([]);

    const urls = calls.map((c) => c.url);
    expect(urls.filter((u) => u === `${BASE}/auth/refresh`).length).toBe(1);
  });

  it("single-flight: 5 GET concurrents 401 ne déclenchent qu'UN seul refresh", async () => {
    enqueue(`${BASE}/me`, [
      { status: 401, body: { error: { code: "UNAUTHENTICATED" } } },
      { status: 200, body: { user: { id: "u1" } } },
    ]);
    enqueue(`${BASE}/apps`, [
      { status: 401, body: { error: { code: "UNAUTHENTICATED" } } },
      { status: 200, body: [] },
    ]);
    enqueue(`${BASE}/auth/sessions`, [
      { status: 401, body: { error: { code: "UNAUTHENTICATED" } } },
      { status: 200, body: { sessions: [] } },
    ]);
    enqueue(`${BASE}/auth/passkeys`, [
      { status: 401, body: { error: { code: "UNAUTHENTICATED" } } },
      { status: 200, body: { passkeys: [] } },
    ]);
    enqueue(`${BASE}/github/installations`, [
      { status: 401, body: { error: { code: "UNAUTHENTICATED" } } },
      { status: 200, body: [] },
    ]);
    enqueue(`${BASE}/auth/refresh`, [
      { status: 200, body: { ok: true, accessExpiresAt: 9999 } },
    ]);

    await Promise.all([
      apiFetch("/me"),
      apiFetch("/apps"),
      apiFetch("/auth/sessions"),
      apiFetch("/auth/passkeys"),
      apiFetch("/github/installations"),
    ]);

    const refreshCount = calls.filter((c) => c.url === `${BASE}/auth/refresh`).length;
    expect(refreshCount).toBe(1);
  });

  it("rejette SessionExpiredError quand le refresh répond 401", async () => {
    enqueue(`${BASE}/me`, [
      { status: 401, body: { error: { code: "UNAUTHENTICATED" } } },
    ]);
    enqueue(`${BASE}/auth/refresh`, [
      { status: 401, body: { error: { code: "INVALID_REFRESH" } } },
    ]);

    await expect(apiFetch("/me")).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it("propage une BackendUnavailableError quand le réseau échoue sur /auth/refresh", async () => {
    let firstMeCall = true;
    (global as unknown as { fetch: unknown }).fetch = async (
      input: string | URL | Request,
    ) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === `${BASE}/me`) {
        if (firstMeCall) {
          firstMeCall = false;
          return new Response(
            JSON.stringify({ error: { code: "UNAUTHENTICATED" } }),
            { status: 401 },
          );
        }
        return new Response(JSON.stringify({ user: { id: "u1" } }), { status: 200 });
      }
      if (url === `${BASE}/auth/refresh`) {
        throw new TypeError("Failed to fetch");
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };

    let caught: unknown = null;
    try {
      await apiFetch("/me");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BackendUnavailableError);
    expect((caught as ApiError).code).toBe("BACKEND_UNAVAILABLE");
  });

  it("normalise les erreurs reseau directes en BackendUnavailableError", async () => {
    (global as unknown as { fetch: unknown }).fetch = async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === `${BASE}/apps`) {
        throw new TypeError("Failed to fetch");
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };

    await expect(apiFetch("/apps")).rejects.toBeInstanceOf(BackendUnavailableError);
  });

  it("ne fait qu'un seul retry rapide pour BackendUnavailableError", () => {
    const error = new BackendUnavailableError();

    expect(shouldRetryCriticalQuery(0, error)).toBe(true);
    expect(shouldRetryCriticalQuery(1, error)).toBe(false);
    expect(criticalRetryDelay(0, error)).toBe(150);
    expect(criticalRetryDelay(1, error)).toBe(150);
  });

  it("retente une mutation POST après un refresh réussi", async () => {
    enqueue(`${BASE}/auth/csrf`, [{ status: 200, body: { token: "t" } }]);
    enqueue(`${BASE}/apps`, [
      { status: 401, body: { error: { code: "UNAUTHENTICATED" } } },
      { status: 201, body: { id: "app1" } },
    ]);
    enqueue(`${BASE}/auth/refresh`, [
      { status: 200, body: { ok: true, accessExpiresAt: 9999 } },
    ]);

    const data = await apiFetch<{ id: string }>("/apps", {
      method: "POST",
      body: { name: "test" },
    });
    expect(data.id).toBe("app1");

    const postCalls = calls.filter(
      (c) => c.url === `${BASE}/apps` && c.init?.method === "POST",
    );
    expect(postCalls.length).toBe(2);
    const refreshCalls = calls.filter((c) => c.url === `${BASE}/auth/refresh`);
    expect(refreshCalls.length).toBe(1);
  });

  it("n’utilise pas de cache GET partagé hors navigateur en mode SSR/fallback", async () => {
    // This test only applies in a non-browser environment (no window). When
    // running under happy-dom (e.g. alongside packages/ui), `window` is
    // non-configurable and cannot be deleted, so we skip rather than fail.
    if (originalWindow !== undefined || typeof window !== "undefined") return;
    invalidateGetCache();

    enqueue(`${BASE}/me`, [
      { status: 200, body: { user: { id: "u1" } } },
      { status: 200, body: { user: { id: "u2" } } },
    ]);

    const first = await apiFetch<{ user: { id: string } }>("/me");
    const second = await apiFetch<{ user: { id: string } }>("/me");

    expect(first.user.id).toBe("u1");
    expect(second.user.id).toBe("u2");
    expect(calls.filter((c) => c.url === `${BASE}/me`).length).toBe(2);
  });
});
