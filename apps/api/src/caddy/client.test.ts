// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CaddyClient } from "./client.js";
import type { CaddyConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Minimal HTTP server harness using Bun.serve
// ---------------------------------------------------------------------------

interface MockRequest {
  method: string;
  path: string;
  body: unknown;
}

interface MockResponse {
  status: number;
  body: unknown;
}

type Handler = (req: MockRequest) => MockResponse;

let server: ReturnType<typeof Bun.serve> | null = null;
let handler: Handler = () => ({ status: 200, body: null });

function startServer(): string {
  server = Bun.serve({
    port: 0, // random free port
    fetch(req) {
      const url = new URL(req.url);
      return req
        .text()
        .then((text) => {
          let body: unknown = null;
          try {
            body = text ? JSON.parse(text) : null;
          } catch {
            body = text;
          }
          const result = handler({ method: req.method, path: url.pathname, body });
          return new Response(
            result.body !== null ? JSON.stringify(result.body) : "",
            {
              status: result.status,
              headers: { "Content-Type": "application/json" },
            },
          );
        });
    },
  });
  return `http://127.0.0.1:${server.port}`;
}

function stopServer(): void {
  server?.stop(true);
  server = null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CaddyClient", () => {
  let baseUrl: string;
  let client: CaddyClient;

  beforeEach(() => {
    baseUrl = startServer();
    client = new CaddyClient(baseUrl);
  });

  afterEach(() => {
    stopServer();
  });

  // -------------------------------------------------------------------------
  // getConfig
  // -------------------------------------------------------------------------

  test("getConfig returns parsed config", async () => {
    const mockConfig: CaddyConfig = { apps: { http: { servers: {} } } };
    handler = () => ({ status: 200, body: mockConfig });

    const config = await client.getConfig();
    expect(config).toEqual(mockConfig);
  });

  test("getConfig returns empty object when Caddy returns null", async () => {
    handler = () => ({ status: 200, body: null });

    const config = await client.getConfig();
    expect(config).toEqual({});
  });

  test("getConfig throws on non-2xx", async () => {
    handler = () => ({ status: 500, body: { error: "oops" } });

    await expect(client.getConfig()).rejects.toThrow("CaddyClient.getConfig failed: 500");
  });

  // -------------------------------------------------------------------------
  // upsertRoute — POST path (new route)
  // -------------------------------------------------------------------------

  test("upsertRoute POSTs a new route when PATCH returns 404", async () => {
    const calls: MockRequest[] = [];
    const existingConfig: CaddyConfig = {
      apps: { http: { servers: { srv0: { listen: [":80"], routes: [] } } } },
    };

    handler = (req) => {
      calls.push(req);
      if (req.method === "GET") return { status: 200, body: existingConfig };
      if (req.method === "PATCH") return { status: 404, body: { error: "not found" } };
      if (req.method === "POST") return { status: 200, body: null };
      return { status: 405, body: null };
    };

    await client.upsertRoute({ host: "app1.localhost", upstream: "localhost:3001", appId: "app1" });

    // upsertRoute = ensureBootstrap GET + PATCH + POST
    const patch = calls.find((c) => c.method === "PATCH");
    const post = calls.find((c) => c.method === "POST");
    expect(patch?.path).toBe("/id/ploydok-app1");
    expect(post?.path).toBe("/config/apps/http/servers/srv0/routes");

    const posted = post?.body as Record<string, unknown>;
    expect(posted["@id"]).toBe("ploydok-app1");
    expect(posted["terminal"]).toBe(true);
  });

  // -------------------------------------------------------------------------
  // upsertRoute — PATCH path (existing route)
  // -------------------------------------------------------------------------

  test("upsertRoute PATCHes existing route without POSTing", async () => {
    const calls: MockRequest[] = [];
    const existingConfig: CaddyConfig = {
      apps: { http: { servers: { srv0: { listen: [":80"], routes: [] } } } },
    };

    handler = (req) => {
      calls.push(req);
      if (req.method === "GET") return { status: 200, body: existingConfig };
      if (req.method === "PATCH") return { status: 200, body: null };
      return { status: 405, body: null };
    };

    await client.upsertRoute({ host: "app2.localhost", upstream: "localhost:3002", appId: "app2" });

    const patch = calls.find((c) => c.method === "PATCH");
    const post = calls.find((c) => c.method === "POST");
    expect(patch?.path).toBe("/id/ploydok-app2");
    expect(post).toBeUndefined();
  });

  test("upsertRoute throws when PATCH returns unexpected error", async () => {
    const existingConfig: CaddyConfig = {
      apps: { http: { servers: { srv0: { listen: [":80"], routes: [] } } } },
    };
    handler = (req) => {
      if (req.method === "GET") return { status: 200, body: existingConfig };
      return { status: 500, body: { error: "internal" } };
    };

    await expect(
      client.upsertRoute({ host: "app3.localhost", upstream: "localhost:3003", appId: "app3" }),
    ).rejects.toThrow("CaddyClient.upsertRoute PATCH failed: 500");
  });

  // -------------------------------------------------------------------------
  // removeRoute
  // -------------------------------------------------------------------------

  test("removeRoute sends DELETE to /id/ploydok-{appId}", async () => {
    const calls: MockRequest[] = [];
    handler = (req) => {
      calls.push(req);
      return { status: 200, body: null };
    };

    await client.removeRoute("myapp");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.path).toBe("/id/ploydok-myapp");
  });

  test("removeRoute is idempotent: 404 is treated as success", async () => {
    handler = () => ({ status: 404, body: { error: "not found" } });

    // Should not throw
    await expect(client.removeRoute("ghost")).resolves.toBeUndefined();
  });

  test("removeRoute throws on unexpected error", async () => {
    handler = () => ({ status: 500, body: { error: "boom" } });

    await expect(client.removeRoute("bad")).rejects.toThrow(
      "CaddyClient.removeRoute failed: 500",
    );
  });

  // -------------------------------------------------------------------------
  // ensureBootstrap
  // -------------------------------------------------------------------------

  test("ensureBootstrap PATCH /config/apps when config is empty", async () => {
    const calls: MockRequest[] = [];

    handler = (req) => {
      calls.push(req);
      if (req.method === "GET") return { status: 200, body: null };
      if (req.method === "PATCH") return { status: 200, body: null };
      return { status: 405, body: null };
    };

    await client.ensureBootstrap();

    // GET /config/ + PATCH /config/apps
    expect(calls).toHaveLength(2);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[1]?.method).toBe("PATCH");
    expect(calls[1]?.path).toBe("/config/apps");

    const posted = calls[1]?.body as Record<string, unknown>;
    const http = posted["http"] as Record<string, unknown>;
    const servers = http["servers"] as Record<string, unknown>;
    expect(servers["srv0"]).toBeDefined();
  });

  test("ensureBootstrap is a no-op when srv0 already exists", async () => {
    const calls: MockRequest[] = [];

    const existingConfig: CaddyConfig = {
      apps: { http: { servers: { srv0: { listen: [":443"], routes: [] } } } },
    };

    handler = (req) => {
      calls.push(req);
      return { status: 200, body: existingConfig };
    };

    await client.ensureBootstrap();

    // Only the GET, no POST
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
  });

  test("ensureBootstrap throws when PATCH and POST both fail", async () => {
    let callCount = 0;

    handler = (req) => {
      callCount++;
      if (req.method === "GET") return { status: 200, body: null };
      return { status: 503, body: { error: "unavailable" } };
    };

    await expect(client.ensureBootstrap()).rejects.toThrow(
      "CaddyClient.ensureBootstrap failed:",
    );
    // GET + PATCH + POST fallback = 3 calls
    expect(callCount).toBe(3);
  });
});
