// SPDX-License-Identifier: AGPL-3.0-only
import { app } from "./app"
import { env } from "./env"
import { wsHandler } from "./routes/ws"
import { getSharedCaddy, getSharedAgent } from "./debug/singletons.js"
import { isAlreadyExists } from "./agent/index.js"
import { childLogger } from "./logger"
import { startWorker } from "./worker"
import { createDb, type Db } from "@ploydok/db"
import {
  fetchRunningAppsForCaddy,
  reconcileCaddyRoutes,
} from "./caddy/reconciler.js"
import { reconcileCaddyAttachments } from "./caddy/attachment.js"
import { bootstrapSetupToken } from "./auth/setup-token"
import { reconcileRuntimeAppsOnBoot } from "./services/app-runtime-reconciler.js"

const log = childLogger("boot")

export function createApp() {
  return app
}

async function bootInfra(db: Db): Promise<void> {
  const caddy = getSharedCaddy()
  const agent = getSharedAgent()

  try {
    const apps = await fetchRunningAppsForCaddy(db)
    const result = await reconcileCaddyRoutes({ caddy, logger: log, apps })
    log.info(result, "caddy reconcile complete")
  } catch (err) {
    log.warn({ err }, "caddy reconcile failed (non-fatal)")
  }

  // Reconcile Caddy ↔ project-network attachments so live apps remain
  // reachable after a Caddy or API restart without waiting for the next deploy.
  try {
    const result = await reconcileCaddyAttachments(agent, db)
    log.info(result, "caddy attachments reconcile complete")
  } catch (err) {
    log.warn({ err }, "caddy attachments reconcile failed (non-fatal)")
  }

  // Legacy flat network (pre-Phase-1.C). Kept so existing apps still resolve
  // until they are redeployed under per-project networks.
  try {
    await agent.networkCreate({
      name: "ploydok-public",
      driver: "bridge",
      labels: {},
    })
    log.info("réseau ploydok-public créé")
  } catch (err) {
    if (isAlreadyExists(err)) {
      log.info("réseau ploydok-public déjà existant")
    } else {
      log.warn({ err }, "networkCreate ploydok-public failed (non-fatal)")
    }
  }

  // Phase 1.C ingress network — Caddy + every app container attach to this.
  // Per-project private networks are created lazily by ensureProjectNetwork
  // at first deploy.
  try {
    await agent.networkCreate({
      name: "ploydok-ingress",
      driver: "bridge",
      labels: { "ploydok.kind": "ingress" },
    })
    log.info("réseau ploydok-ingress créé")
  } catch (err) {
    if (isAlreadyExists(err)) {
      log.info("réseau ploydok-ingress déjà existant")
    } else {
      log.warn({ err }, "networkCreate ploydok-ingress failed (non-fatal)")
    }
  }

  try {
    const result = await reconcileRuntimeAppsOnBoot(db, agent)
    log.info(result, "runtime app reconcile complete")
  } catch (err) {
    log.warn({ err }, "runtime app reconcile failed (non-fatal)")
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
  })
  log.info({ port: env.PORT }, `api listening on :${env.PORT}`)

  const workerDb = createDb(env.DATABASE_URL)
  const worker = startWorker(workerDb)
  log.info("worker started (polling jobs every 2s)")

  const shutdown = () => {
    log.info("worker stopping...")
    worker.stop()
  }
  process.on("SIGTERM", shutdown)
  process.on("SIGINT", shutdown)

  // bootInfra est toujours exécuté (sauf en test) : le reconciler et
  // networkCreate sont idempotents et gèrent Caddy/agent absents en warn.
  if (env.NODE_ENV !== "test") {
    bootInfra(workerDb).catch((err) => {
      log.error({ err }, "erreur inattendue au boot")
    })
    bootstrapSetupToken(workerDb).catch((err) => {
      log.error({ err }, "setup-token bootstrap failed")
    })
  }
}
