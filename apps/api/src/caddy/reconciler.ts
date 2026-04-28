// SPDX-License-Identifier: AGPL-3.0-only
//
// Au boot de l'API, Caddy peut avoir été redémarré en parallèle (docker compose
// up, crash, reboot host) et perdu son état mémoire. La DB reste la source de
// vérité pour les routes applicatives : on re-pousse toutes les routes des
// apps `running`/`restarting` vers l'Admin API Caddy. Idempotent via
// `setUpstream` (PATCH si route existe, POST sinon).
import { and, inArray, isNotNull } from "drizzle-orm"
import { apps as appsTable, type Db } from "@ploydok/db"
import type { CaddyClient } from "./client.js"
import type { Logger } from "pino"
import { caddyStaticRootForApp } from "../worker/handlers/build-static.js"
export { applyCdnHandlers, type CdnAppConfig } from "./cdn.js"

export interface AppForReconcile {
  id: string
  domain: string | null
  container_id: string | null
  runtime_port: number | null
  healthcheck_port: number | null
  build_method: string | null
  static_spa_fallback: boolean | null
  cdn_mode: "off" | "internal" | "external"
  cdn_cache_ttl_s: number | null
  cdn_cache_paths: string[] | null
  cdn_compression: boolean | null
  cdn_image_optim: boolean | null
  cdn_headers: string | null
  cdn_external_provider: string | null
}

export interface ReconcileResult {
  bootstrapped: boolean
  synced: number
  skipped: number
  failed: number
}

export async function fetchRunningAppsForCaddy(
  db: Db
): Promise<AppForReconcile[]> {
  return db
    .select({
      id: appsTable.id,
      domain: appsTable.domain,
      container_id: appsTable.container_id,
      runtime_port: appsTable.runtime_port,
      healthcheck_port: appsTable.healthcheck_port,
      build_method: appsTable.build_method,
      static_spa_fallback: appsTable.static_spa_fallback,
      cdn_mode: appsTable.cdn_mode,
      cdn_cache_ttl_s: appsTable.cdn_cache_ttl_s,
      cdn_cache_paths: appsTable.cdn_cache_paths,
      cdn_compression: appsTable.cdn_compression,
      cdn_image_optim: appsTable.cdn_image_optim,
      cdn_headers: appsTable.cdn_headers,
      cdn_external_provider: appsTable.cdn_external_provider,
    })
    .from(appsTable)
    .where(
      and(
        inArray(appsTable.status, ["running", "restarting", "serving"]),
        isNotNull(appsTable.domain)
      )
    )
}

export interface ReconcileOptions {
  caddy: CaddyClient
  logger: Logger
  apps: AppForReconcile[]
  defaultPort?: number
  bootstrapRetries?: number
  bootstrapBackoffMs?: number
}

export async function reconcileCaddyRoutes(
  opts: ReconcileOptions
): Promise<ReconcileResult> {
  const {
    caddy,
    logger,
    apps,
    defaultPort = 3000,
    bootstrapRetries = 3,
    bootstrapBackoffMs = 500,
  } = opts

  const result: ReconcileResult = {
    bootstrapped: false,
    synced: 0,
    skipped: 0,
    failed: 0,
  }

  const bootstrapped = await tryBootstrap(
    caddy,
    logger,
    bootstrapRetries,
    bootstrapBackoffMs
  )
  result.bootstrapped = bootstrapped
  if (!bootstrapped) return result

  for (const row of apps) {
    if (!row.domain) {
      result.skipped++
      continue
    }
    try {
      if (row.build_method === "static") {
        await caddy.upsertStaticRoute({
          appId: row.id,
          host: row.domain,
          root: caddyStaticRootForApp(row.id),
          spaFallback: row.static_spa_fallback ?? true,
          cdn: row,
        })
      } else {
        if (!row.container_id) {
          result.skipped++
          continue
        }
        const port = row.runtime_port ?? row.healthcheck_port ?? defaultPort
        await caddy.setUpstream(
          row.id,
          row.domain,
          { host: row.container_id, port },
          { cdn: row }
        )
      }
      result.synced++
      logger.info({ appId: row.id, host: row.domain }, "caddy route reconciled")
    } catch (err) {
      result.failed++
      logger.warn(
        { err, appId: row.id, host: row.domain },
        "caddy route reconcile failed"
      )
    }
  }

  logger.info(result, "caddy reconcile done")
  return result
}

async function tryBootstrap(
  caddy: CaddyClient,
  logger: Logger,
  retries: number,
  backoffMs: number
): Promise<boolean> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await caddy.ensureBootstrap()
      return true
    } catch (err) {
      if (attempt === retries) {
        logger.warn(
          { err, attempts: attempt },
          "caddy bootstrap failed — reconcile skipped"
        )
        return false
      }
      await new Promise((r) => setTimeout(r, backoffMs * attempt))
    }
  }
  return false
}
