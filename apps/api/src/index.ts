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
  fetchPublicDatabaseProxiesForCaddy,
  fetchRunningAppsForCaddy,
  fetchRunningServicesForCaddy,
  reconcileDatabaseTcpProxies,
  reconcileCaddyRoutes,
  reconcileServiceRoutes,
} from "./caddy/reconciler.js"
import { reconcileCaddyAttachments } from "./caddy/attachment.js"
import { bootstrapSetupToken } from "./auth/setup-token"
import { reconcileRuntimeAppsOnBoot } from "./services/app-runtime-reconciler.js"

const log = childLogger("boot")

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createApp() {
  return app
}

async function bootInfra(db: Db): Promise<void> {
  const caddy = getSharedCaddy()
  const agent = getSharedAgent()

  await reconcileIngressWithRetry(db, caddy, agent)

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

async function reconcileIngressWithRetry(
  db: Db,
  caddy: ReturnType<typeof getSharedCaddy>,
  agent: ReturnType<typeof getSharedAgent>
): Promise<void> {
  const attempts = Number(Bun.env["PLOYDOK_INGRESS_RECONCILE_ATTEMPTS"] ?? 30)
  const delayMs = Number(Bun.env["PLOYDOK_INGRESS_RECONCILE_DELAY_MS"] ?? 1000)

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const [apps, services, databases] = await Promise.all([
        fetchRunningAppsForCaddy(db),
        fetchRunningServicesForCaddy(db),
        fetchPublicDatabaseProxiesForCaddy(db),
      ])
      const [appRoutes, serviceRoutes, databaseProxies, attachments] =
        await Promise.all([
          reconcileCaddyRoutes({ caddy, logger: log, apps }),
          reconcileServiceRoutes({ caddy, logger: log, services }),
          reconcileDatabaseTcpProxies({ caddy, logger: log, databases }),
          reconcileCaddyAttachments(agent, db),
        ])

      const failed =
        appRoutes.failed +
        serviceRoutes.failed +
        databaseProxies.failed +
        attachments.failed

      if (
        appRoutes.bootstrapped &&
        serviceRoutes.bootstrapped &&
        databaseProxies.bootstrapped &&
        failed === 0
      ) {
        log.info(
          { appRoutes, serviceRoutes, databaseProxies, attachments, attempt },
          "ingress reconcile complete"
        )
        return
      }

      log.warn(
        { appRoutes, serviceRoutes, databaseProxies, attachments, attempt },
        "ingress reconcile incomplete"
      )
    } catch (err) {
      log.warn({ err, attempt }, "ingress reconcile failed")
    }

    if (attempt < attempts) {
      await sleep(delayMs)
    }
  }

  log.error({ attempts }, "ingress reconcile exhausted")
}

if (import.meta.main) {
  // M3.2: pass the BunWebSocket handler so Bun can upgrade WS connections.
  // idleTimeout: 0 disables the 10 s default so long-lived SSE streams
  // (GET /events) don't get chunk-encoded-truncated before their first
  // heartbeat. Per-request sockets are still closed on client abort.
  const server = Bun.serve({
    port: env.PORT,
    fetch: app.fetch,
    websocket: wsHandler,
    idleTimeout: 0,
  })
  log.info({ port: env.PORT }, `api listening on :${env.PORT}`)

  const workerDb = createDb(env.DATABASE_URL)
  const worker = startWorker(workerDb)
  log.info("worker started (polling jobs every 2s)")

  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    log.info("worker stopping...")
    await worker.stop()
    server.stop(true)
    process.exit(0)
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
