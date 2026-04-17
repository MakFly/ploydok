// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach, spyOn } from "bun:test";
import { GitHubCache } from "./cache";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FetchLike = (url: string | Request | URL, init?: RequestInit) => Promise<Response>;

function makeFetch(fn: FetchLike): typeof fetch {
  return fn as unknown as typeof fetch;
}

function makeResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GitHubCache", () => {
  let cache: GitHubCache;
  let fetchCalls: Array<[string, RequestInit]>;

  beforeEach(() => {
    cache = new GitHubCache();
    fetchCalls = [];
  });

  it("fetches the URL on first call and stores the result", async () => {
    const data = [{ id: 1 }];

    using _fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      makeFetch(async (url, init) => {
        fetchCalls.push([url.toString(), init ?? {}]);
        return makeResponse(data, 200, { etag: '"abc123"' });
      }),
    );

    const result = await cache.fetch("https://api.github.com/user/repos", {
      headers: { Authorization: "Bearer token" },
    });

    expect(result.status).toBe(200);
    expect(result.data).toEqual(data);
    expect(fetchCalls.length).toBe(1);
  });

  it("sends If-None-Match on second call when ETag is cached and TTL is valid", async () => {
    const data = [{ id: 1 }];
    let callCount = 0;

    using _fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      makeFetch(async (url, init) => {
        callCount++;
        fetchCalls.push([url.toString(), init ?? {}]);
        if (callCount === 1) {
          return makeResponse(data, 200, { etag: '"etag-v1"' });
        }
        // Second call: verify If-None-Match was sent
        const reqHeaders = (init?.headers ?? {}) as Record<string, string>;
        expect(reqHeaders["If-None-Match"]).toBe('"etag-v1"');
        return new Response(null, { status: 304 });
      }),
    );

    await cache.fetch("https://api.github.com/user/repos", { headers: {} });
    const result = await cache.fetch("https://api.github.com/user/repos", { headers: {} });

    expect(callCount).toBe(2);
    expect(result.status).toBe(200);
    expect(result.data).toEqual(data);
  });

  it("returns cached data (status 200) when server responds 304", async () => {
    const data = { id: 42, name: "repo" };
    let callCount = 0;

    using _fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      makeFetch(async () => {
        callCount++;
        if (callCount === 1) return makeResponse(data, 200, { etag: '"v1"' });
        return new Response(null, { status: 304 });
      }),
    );

    await cache.fetch("https://api.github.com/repos/foo/bar", { headers: {} });
    const result = await cache.fetch("https://api.github.com/repos/foo/bar", { headers: {} });

    expect(result.status).toBe(200);
    expect(result.data).toEqual(data);
  });

  it("updates stored data on a fresh 200 response", async () => {
    const first = [{ id: 1 }];
    const second = [{ id: 2 }];
    let callCount = 0;

    using _fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      makeFetch(async () => {
        callCount++;
        return callCount === 1
          ? makeResponse(first, 200, { etag: '"v1"' })
          : makeResponse(second, 200, { etag: '"v2"' });
      }),
    );

    await cache.fetch("https://api.github.com/user/repos", { headers: {} });
    const result = await cache.fetch("https://api.github.com/user/repos", { headers: {} });

    expect(result.data).toEqual(second);
  });

  it("invalidate() clears the entire cache", async () => {
    using _fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      makeFetch(async () => makeResponse([], 200, { etag: '"v1"' })),
    );

    await cache.fetch("https://api.github.com/user/repos", { headers: {} });
    cache.invalidate();

    // After invalidation, next fetch should NOT send If-None-Match
    let sentHeaders: Record<string, string> = {};
    using _fetchSpy2 = spyOn(globalThis, "fetch").mockImplementation(
      makeFetch(async (_url, init) => {
        sentHeaders = (init?.headers ?? {}) as Record<string, string>;
        return makeResponse([], 200, { etag: '"v2"' });
      }),
    );

    await cache.fetch("https://api.github.com/user/repos", { headers: {} });
    expect(sentHeaders["If-None-Match"]).toBeUndefined();
  });

  it("invalidate(pattern) removes only matching entries", async () => {
    using _fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      makeFetch(async (url) => {
        const u = url.toString();
        if (u.includes("repos")) return makeResponse([1], 200, { etag: '"r"' });
        return makeResponse({ id: 1 }, 200, { etag: '"u"' });
      }),
    );

    await cache.fetch("https://api.github.com/user/repos", { headers: {} });
    await cache.fetch("https://api.github.com/user", { headers: {} });

    cache.invalidate("repos");

    // repos entry should be gone — next call should NOT send If-None-Match for repos
    // but /user entry should still be present
    let repoHeaders: Record<string, string> = {};
    let userHeaders: Record<string, string> = {};

    using _fetchSpy2 = spyOn(globalThis, "fetch").mockImplementation(
      makeFetch(async (url, init) => {
        const u = url.toString();
        const h = (init?.headers ?? {}) as Record<string, string>;
        if (u.includes("repos")) {
          repoHeaders = h;
          return makeResponse([1], 200);
        }
        userHeaders = h;
        return new Response(null, { status: 304 });
      }),
    );

    await cache.fetch("https://api.github.com/user/repos", { headers: {} });
    await cache.fetch("https://api.github.com/user", { headers: {} });

    expect(repoHeaders["If-None-Match"]).toBeUndefined();
    expect(userHeaders["If-None-Match"]).toBe('"u"');
  });
});
