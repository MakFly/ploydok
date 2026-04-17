// SPDX-License-Identifier: AGPL-3.0-only
import { app } from "./app";
import { env } from "./env";
import { wsHandler } from "./routes/ws";
import { getSharedCaddy, getSharedAgent } from "./debug/singletons.js";
import { AgentError, GrpcStatus } from "./agent/index.js";
import { childLogger } from "./logger";
import { startWorker } from "./worker";
import { createDb } from "@ploydok/db";

const log = childLogger("boot");

export function createApp() {
  return app;
}

async function bootInfra(): Promise<void> {
  const caddy = getSharedCaddy();
  const agent = getSharedAgent();

  try {
    await caddy.ensureBootstrap();
    log.info("Caddy bootstrap OK");
  } catch (err) {
    log.warn({ err }, "Caddy bootstrap failed (non-fatal)");
  }

  try {
    await agent.networkCreate({ name: "ploydok-public", driver: "bridge", labels: {} });
    log.info("réseau ploydok-public créé");
  } catch (err) {
    if (err instanceof AgentError && err.code === GrpcStatus.ALREADY_EXISTS) {
      log.info("réseau ploydok-public déjà existant");
    } else {
      log.warn({ err }, "networkCreate ploydok-public failed (non-fatal)");
    }
  }
}

if (import.meta.main) {
  // M3.2: pass the BunWebSocket handler so Bun can upgrade WS connections.
  // idleTimeout: 0 disables the 10 s default so long-lived SSE streams
  // (GET /events) don't get chunk-encoded-truncated before their first
  // heartbeat. Per-request sockets are still closed on client abort.
  Bun.serve({
    port: env.PORT,
    fetch: app.fetch,
    websocket: wsHandler,
    idleTimeout: 0,
  });
  log.info({ port: env.PORT }, `api listening on :${env.PORT}`);

  const workerDb = createDb(env.DATABASE_URL)
  const worker = startWorker(workerDb)
  log.info("worker started (polling jobs every 2s)")

  const shutdown = () => {
    log.info("worker stopping...")
    worker.stop()
  }
  process.on("SIGTERM", shutdown)
  process.on("SIGINT", shutdown)

  // En dev : bootInfra skippé par défaut (évite warn Caddy/agent absents).
  // Activer explicitement via PLOYDOK_BOOT_INFRA=1 (ou via NODE_ENV=prod/test).
  const shouldBoot =
    env.NODE_ENV !== "dev" || Bun.env["PLOYDOK_BOOT_INFRA"] === "1";
  if (shouldBoot) {
    bootInfra().catch((err) => {
      log.error({ err }, "erreur inattendue au boot");
    });
  } else {
    log.debug("bootInfra skippé en dev (set PLOYDOK_BOOT_INFRA=1 pour l'activer)");
  }
}
