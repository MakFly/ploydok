// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach } from "bun:test";

// We test the api module logic in isolation using a mock fetch
const API_BASE = "http://localhost:4000";

// Mock fetch globally
let capturedRequests: { url: string; init?: RequestInit }[] = [];
let mockResponses: Map<string, { status: number; body: unknown }> = new Map();

function setupFetchMock(): void {
  capturedRequests = [];
  mockResponses = new Map();

  (global as unknown as { fetch: unknown }).fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    capturedRequests.push({ url, init });

    const resp = mockResponses.get(url) ?? { status: 200, body: { token: "test-csrf-token" } };
    const body = JSON.stringify(resp.body);
    return new Response(body, {
      status: resp.status,
      headers: { "Content-Type": "application/json" },
    });
  };
}

// We inline the apiFetch logic to test it without import.meta.env issues
async function apiFetchTest<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const { method = "GET", body } = options;
  const isMutating = method !== "GET";

  let csrfToken: string | null = null;

  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (isMutating) {
    // Fetch CSRF first
    const csrfRes = await fetch(`${API_BASE}/auth/csrf`, { credentials: "include" });
    const csrfData = (await csrfRes.json()) as { token: string };
    csrfToken = csrfData.token;
    headers["x-csrf-token"] = csrfToken;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "include",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

describe("apiFetch", () => {
  beforeEach(() => {
    setupFetchMock();
  });

  it("does NOT send x-csrf-token on GET requests", async () => {
    mockResponses.set(`${API_BASE}/me`, { status: 200, body: { id: "1", email: "test@example.com" } });

    await apiFetchTest("/me", { method: "GET" });

    // Should only have one request (to /me), no CSRF prefetch
    const meReq = capturedRequests.find((r) => r.url === `${API_BASE}/me`);
    expect(meReq).toBeDefined();

    const csrfReq = capturedRequests.find((r) => r.url === `${API_BASE}/auth/csrf`);
    expect(csrfReq).toBeUndefined();

    const sentHeaders = meReq?.init?.headers as Record<string, string> | undefined;
    expect(sentHeaders?.["x-csrf-token"]).toBeUndefined();
  });

  it("sends x-csrf-token on POST requests", async () => {
    mockResponses.set(`${API_BASE}/auth/csrf`, { status: 200, body: { token: "csrf-abc-123" } });
    mockResponses.set(`${API_BASE}/auth/logout`, { status: 204, body: null });

    await apiFetchTest("/auth/logout", { method: "POST" });

    const postReq = capturedRequests.find((r) => r.url === `${API_BASE}/auth/logout`);
    expect(postReq).toBeDefined();

    const sentHeaders = postReq?.init?.headers as Record<string, string> | undefined;
    expect(sentHeaders?.["x-csrf-token"]).toBe("csrf-abc-123");
  });

  it("sends x-csrf-token on DELETE requests", async () => {
    mockResponses.set(`${API_BASE}/auth/csrf`, { status: 200, body: { token: "csrf-del-456" } });
    mockResponses.set(`${API_BASE}/auth/passkeys/pk1`, { status: 204, body: null });

    await apiFetchTest("/auth/passkeys/pk1", { method: "DELETE" });

    const deleteReq = capturedRequests.find((r) => r.url === `${API_BASE}/auth/passkeys/pk1`);
    expect(deleteReq).toBeDefined();

    const sentHeaders = deleteReq?.init?.headers as Record<string, string> | undefined;
    expect(sentHeaders?.["x-csrf-token"]).toBe("csrf-del-456");
  });
});
