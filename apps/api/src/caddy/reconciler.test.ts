// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from "bun:test";
import pino from "pino";
import { reconcileCaddyRoutes, type AppForReconcile } from "./reconciler.js";
import type { CaddyClient } from "./client.js";

const silentLogger = pino({ level: "silent" });

function createFakeCaddy(overrides: Partial<FakeCaddyCalls> = {}): {
  caddy: CaddyClient;
  calls: FakeCaddyCalls;
} {
  const calls: FakeCaddyCalls = {
    bootstrap: 0,
    upserts: [],
    bootstrapErrors: overrides.bootstrapErrors ?? 0,
    upsertErrorFor: overrides.upsertErrorFor ?? new Set(),
  };

  const caddy = {
    async ensureBootstrap() {
      calls.bootstrap++;
      if (calls.bootstrap <= calls.bootstrapErrors) {
        throw new Error(`bootstrap failed (attempt ${calls.bootstrap})`);
      }
    },
    async setUpstream(
      appId: string,
      host: string,
      upstream: { host: string; port: number },
    ) {
      if (calls.upsertErrorFor.has(appId)) {
        throw new Error(`upstream failed for ${appId}`);
      }
      calls.upserts.push({ appId, host, upstream });
    },
  } as unknown as CaddyClient;

  return { caddy, calls };
}

interface FakeCaddyCalls {
  bootstrap: number;
  upserts: Array<{ appId: string; host: string; upstream: { host: string; port: number } }>;
  bootstrapErrors: number;
  upsertErrorFor: Set<string>;
}

describe("reconcileCaddyRoutes", () => {
  test("upserts une route par app prête", async () => {
    const { caddy, calls } = createFakeCaddy();
    const apps: AppForReconcile[] = [
      { id: "a1", domain: "a1.test.local", container_id: "ploydok-app-a1-blue", healthcheck_port: 3000 },
      { id: "a2", domain: "a2.test.local", container_id: "ploydok-app-a2-green", healthcheck_port: 8080 },
    ];

    const result = await reconcileCaddyRoutes({ caddy, logger: silentLogger, apps });

    expect(result).toEqual({ bootstrapped: true, synced: 2, skipped: 0, failed: 0 });
    expect(calls.upserts).toEqual([
      { appId: "a1", host: "a1.test.local", upstream: { host: "ploydok-app-a1-blue", port: 3000 } },
      { appId: "a2", host: "a2.test.local", upstream: { host: "ploydok-app-a2-green", port: 8080 } },
    ]);
  });

  test("fallback port par défaut si healthcheck_port absent", async () => {
    const { caddy, calls } = createFakeCaddy();
    const apps: AppForReconcile[] = [
      { id: "a1", domain: "a1.test.local", container_id: "ploydok-app-a1-blue", healthcheck_port: null },
    ];

    await reconcileCaddyRoutes({ caddy, logger: silentLogger, apps, defaultPort: 4242 });

    expect(calls.upserts[0]?.upstream.port).toBe(4242);
  });

  test("skip les apps sans domain ou container_id", async () => {
    const { caddy, calls } = createFakeCaddy();
    const apps: AppForReconcile[] = [
      { id: "a1", domain: null, container_id: "ploydok-app-a1-blue", healthcheck_port: 3000 },
      { id: "a2", domain: "a2.test.local", container_id: null, healthcheck_port: 3000 },
      { id: "a3", domain: "a3.test.local", container_id: "ploydok-app-a3-blue", healthcheck_port: 3000 },
    ];

    const result = await reconcileCaddyRoutes({ caddy, logger: silentLogger, apps });

    expect(result.synced).toBe(1);
    expect(result.skipped).toBe(2);
    expect(calls.upserts).toHaveLength(1);
    expect(calls.upserts[0]?.appId).toBe("a3");
  });

  test("une erreur Caddy par app n'arrête pas la boucle", async () => {
    const { caddy, calls } = createFakeCaddy({ upsertErrorFor: new Set(["a1"]) });
    const apps: AppForReconcile[] = [
      { id: "a1", domain: "a1.test.local", container_id: "ploydok-app-a1-blue", healthcheck_port: 3000 },
      { id: "a2", domain: "a2.test.local", container_id: "ploydok-app-a2-blue", healthcheck_port: 3000 },
    ];

    const result = await reconcileCaddyRoutes({ caddy, logger: silentLogger, apps });

    expect(result).toEqual({ bootstrapped: true, synced: 1, skipped: 0, failed: 1 });
    expect(calls.upserts.map((c) => c.appId)).toEqual(["a2"]);
  });

  test("retry bootstrap avec backoff (2 erreurs puis succès)", async () => {
    const { caddy, calls } = createFakeCaddy({ bootstrapErrors: 2 });
    const apps: AppForReconcile[] = [
      { id: "a1", domain: "a1.test.local", container_id: "ploydok-app-a1-blue", healthcheck_port: 3000 },
    ];

    const result = await reconcileCaddyRoutes({
      caddy,
      logger: silentLogger,
      apps,
      bootstrapRetries: 3,
      bootstrapBackoffMs: 1,
    });

    expect(calls.bootstrap).toBe(3);
    expect(result.bootstrapped).toBe(true);
    expect(result.synced).toBe(1);
  });

  test("bootstrap échoue après N retries — skip la boucle sans throw", async () => {
    const { caddy, calls } = createFakeCaddy({ bootstrapErrors: 5 });
    const apps: AppForReconcile[] = [
      { id: "a1", domain: "a1.test.local", container_id: "ploydok-app-a1-blue", healthcheck_port: 3000 },
    ];

    const result = await reconcileCaddyRoutes({
      caddy,
      logger: silentLogger,
      apps,
      bootstrapRetries: 2,
      bootstrapBackoffMs: 1,
    });

    expect(result).toEqual({ bootstrapped: false, synced: 0, skipped: 0, failed: 0 });
    expect(calls.upserts).toHaveLength(0);
  });
});
