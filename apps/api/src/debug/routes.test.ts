// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Hono } from "hono";
import { createDebugRouter } from "./routes.js";
import type { Agent } from "../agent/index.js";
import { AgentError, GrpcStatus } from "../agent/index.js";
import type { CaddyClient } from "../caddy/index.js";

// ---------------------------------------------------------------------------
// Helpers — fake AgentError for NOT_FOUND / ALREADY_EXISTS
// ---------------------------------------------------------------------------

function makeAgentError(code: number, message = "agent error"): AgentError {
  const se = Object.assign(new Error(message), {
    code,
    details: message,
    metadata: { getMap: () => ({}) },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
  return new AgentError(se);
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

type MockAgent = {
  containerCreate: ReturnType<typeof mock>;
  containerStart: ReturnType<typeof mock>;
  containerStop: ReturnType<typeof mock>;
  containerRemove: ReturnType<typeof mock>;
};

type MockCaddy = {
  upsertRoute: ReturnType<typeof mock>;
  removeRoute: ReturnType<typeof mock>;
  ensureBootstrap: ReturnType<typeof mock>;
};

function makeMockAgent(): MockAgent {
  return {
    containerCreate: mock(async () => ({ containerId: "cid-abc123" })),
    containerStart: mock(async () => ({})),
    containerStop: mock(async () => ({})),
    containerRemove: mock(async () => ({})),
  };
}

function makeMockCaddy(): MockCaddy {
  return {
    upsertRoute: mock(async () => undefined),
    removeRoute: mock(async () => undefined),
    ensureBootstrap: mock(async () => undefined),
  };
}

// ---------------------------------------------------------------------------
// Test app builder — wraps the debug router with a fake auth context
// ---------------------------------------------------------------------------

function buildApp(
  agent: MockAgent,
  caddy: MockCaddy,
  authed = true,
): Hono {
  const app = new Hono();

  // Inject fake user into context (simulates requireAuth having run)
  app.use("*", async (c, next) => {
    if (authed) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c as any).set("user", { id: "user-1", email: "test@example.com", display_name: "Test" });
    }
    return next();
  });

  const router = createDebugRouter({ agent: agent as unknown as Agent, caddy: caddy as unknown as CaddyClient });
  app.route("/debug", router);
  return app as Hono;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /debug/spawn-nginx", () => {
  let agent: ReturnType<typeof makeMockAgent>;
  let caddy: ReturnType<typeof makeMockCaddy>;

  beforeEach(() => {
    agent = makeMockAgent();
    caddy = makeMockCaddy();
  });

  it("happy path — calls containerCreate, upsertRoute, containerStart and returns JSON", async () => {
    const app = buildApp(agent, caddy);
    const res = await app.request("/debug/spawn-nginx", { method: "POST" });

    expect(res.status).toBe(201);
    const body = await res.json() as {
      appId: string;
      containerId: string;
      url: string;
      containerName: string;
    };

    expect(body.appId).toBeString();
    expect(body.containerId).toBe("cid-abc123");
    expect(body.url).toContain(body.appId);
    expect(body.containerName).toBe(`ploydok-${body.appId}`);

    expect(agent.containerCreate).toHaveBeenCalledTimes(1);
    const rawCall = agent.containerCreate.mock.calls[0];
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const createCall = rawCall![0] as {
      name: string;
      image: string;
      labels: Record<string, string>;
      network: string;
    };
    expect(createCall.image).toBe("nginx:alpine");
    expect(createCall.network).toBe("ploydok-public");
    expect(createCall.labels["ploydok.owner_id"]).toBe("user-1");
    expect(createCall.name).toMatch(/^ploydok-[a-z0-9]{10}$/);

    expect(caddy.upsertRoute).toHaveBeenCalledTimes(1);
    expect(agent.containerStart).toHaveBeenCalledTimes(1);
  });

  it("rollback — containerStart throws → calls containerRemove + removeRoute", async () => {
    agent.containerStart = mock(async () => {
      throw makeAgentError(GrpcStatus.INTERNAL, "start failed");
    });
    const app = buildApp(agent, caddy);
    const res = await app.request("/debug/spawn-nginx", { method: "POST" });

    expect(res.status).toBe(500);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("SPAWN_FAILED");

    // Rollback: route removed and container removed
    expect(caddy.removeRoute).toHaveBeenCalledTimes(1);
    expect(agent.containerRemove).toHaveBeenCalledTimes(1);
  });

  it("rollback — upsertRoute throws → calls containerRemove but NOT removeRoute", async () => {
    caddy.upsertRoute = mock(async () => {
      throw new Error("caddy unreachable");
    });
    const app = buildApp(agent, caddy);
    const res = await app.request("/debug/spawn-nginx", { method: "POST" });

    expect(res.status).toBe(500);
    // Route was never upserted → removeRoute not called
    expect(caddy.removeRoute).not.toHaveBeenCalled();
    // Container was created → should be removed
    expect(agent.containerRemove).toHaveBeenCalledTimes(1);
  });

  it("auth — no session → 401", async () => {
    const app = buildApp(agent, caddy, false);
    const res = await app.request("/debug/spawn-nginx", { method: "POST" });
    expect(res.status).toBe(401);
    expect(agent.containerCreate).not.toHaveBeenCalled();
  });
});

describe("DELETE /debug/spawn-nginx/:appId", () => {
  let agent: ReturnType<typeof makeMockAgent>;
  let caddy: ReturnType<typeof makeMockCaddy>;

  beforeEach(() => {
    agent = makeMockAgent();
    caddy = makeMockCaddy();
  });

  it("happy path — calls removeRoute, containerStop, containerRemove in order", async () => {
    const app = buildApp(agent, caddy);
    const callOrder: string[] = [];

    caddy.removeRoute = mock(async () => { callOrder.push("removeRoute"); });
    agent.containerStop = mock(async () => { callOrder.push("containerStop"); return {}; });
    agent.containerRemove = mock(async () => { callOrder.push("containerRemove"); return {}; });

    const router = createDebugRouter({ agent: agent as unknown as Agent, caddy: caddy as unknown as CaddyClient });
    const orderedApp = new Hono();
    orderedApp.use("*", async (c, next) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c as any).set("user", { id: "user-1" });
      return next();
    });
    orderedApp.route("/debug", router);

    const res = await orderedApp.request("/debug/spawn-nginx/myapp123ab", { method: "DELETE" });

    expect(res.status).toBe(200);
    const body = await res.json() as { appId: string; removed: boolean };
    expect(body.appId).toBe("myapp123ab");
    expect(body.removed).toBe(true);

    expect(callOrder).toEqual(["removeRoute", "containerStop", "containerRemove"]);
  });

  it("idempotent — NOT_FOUND on containerStop and containerRemove → still returns 200", async () => {
    agent.containerStop = mock(async () => {
      throw makeAgentError(GrpcStatus.NOT_FOUND, "not found");
    });
    agent.containerRemove = mock(async () => {
      throw makeAgentError(GrpcStatus.NOT_FOUND, "not found");
    });

    const app = buildApp(agent, caddy);
    const res = await app.request("/debug/spawn-nginx/someapp1ab", { method: "DELETE" });

    expect(res.status).toBe(200);
    const body = await res.json() as { removed: boolean };
    expect(body.removed).toBe(true);
  });

  it("auth — no session → 401", async () => {
    const app = buildApp(agent, caddy, false);
    const res = await app.request("/debug/spawn-nginx/someapp1ab", { method: "DELETE" });
    expect(res.status).toBe(401);
    expect(caddy.removeRoute).not.toHaveBeenCalled();
  });
});
