// SPDX-License-Identifier: AGPL-3.0-only
//
// Au boot de l'API, Caddy peut avoir été redémarré en parallèle (docker compose
// up, crash, reboot host) et perdu son état mémoire. La DB reste la source de
// vérité pour les routes applicatives : on re-pousse toutes les routes des
// apps `running`/`restarting` vers l'Admin API Caddy. Idempotent via
// `setUpstream` (PATCH si route existe, POST sinon).
import { and, inArray, isNotNull } from "drizzle-orm";
import { apps as appsTable, type Db } from "@ploydok/db";
import type { CaddyClient } from "./client.js";
import type { Logger } from "pino";

export interface AppForReconcile {
  id: string;
  domain: string | null;
  container_id: string | null;
  healthcheck_port: number | null;
}

export interface ReconcileResult {
  bootstrapped: boolean;
  synced: number;
  skipped: number;
  failed: number;
}

export async function fetchRunningAppsForCaddy(db: Db): Promise<AppForReconcile[]> {
  return db
    .select({
      id: appsTable.id,
      domain: appsTable.domain,
      container_id: appsTable.container_id,
      healthcheck_port: appsTable.healthcheck_port,
    })
    .from(appsTable)
    .where(
      and(
        inArray(appsTable.status, ["running", "restarting"]),
        isNotNull(appsTable.domain),
        isNotNull(appsTable.container_id),
      ),
    );
}

export interface ReconcileOptions {
  caddy: CaddyClient;
  logger: Logger;
  apps: AppForReconcile[];
  defaultPort?: number;
  bootstrapRetries?: number;
  bootstrapBackoffMs?: number;
}

export async function reconcileCaddyRoutes(opts: ReconcileOptions): Promise<ReconcileResult> {
  const {
    caddy,
    logger,
    apps,
    defaultPort = 3000,
    bootstrapRetries = 3,
    bootstrapBackoffMs = 500,
  } = opts;

  const result: ReconcileResult = { bootstrapped: false, synced: 0, skipped: 0, failed: 0 };

  const bootstrapped = await tryBootstrap(caddy, logger, bootstrapRetries, bootstrapBackoffMs);
  result.bootstrapped = bootstrapped;
  if (!bootstrapped) return result;

  for (const row of apps) {
    if (!row.domain || !row.container_id) {
      result.skipped++;
      continue;
    }
    const port = row.healthcheck_port ?? defaultPort;
    try {
      await caddy.setUpstream(row.id, row.domain, { host: row.container_id, port });
      result.synced++;
      logger.info(
        { appId: row.id, host: row.domain, upstream: `${row.container_id}:${port}` },
        "caddy route reconciled",
      );
    } catch (err) {
      result.failed++;
      logger.warn({ err, appId: row.id, host: row.domain }, "caddy route reconcile failed");
    }
  }

  logger.info(result, "caddy reconcile done");
  return result;
}

async function tryBootstrap(
  caddy: CaddyClient,
  logger: Logger,
  retries: number,
  backoffMs: number,
): Promise<boolean> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await caddy.ensureBootstrap();
      return true;
    } catch (err) {
      if (attempt === retries) {
        logger.warn({ err, attempts: attempt }, "caddy bootstrap failed — reconcile skipped");
        return false;
      }
      await new Promise((r) => setTimeout(r, backoffMs * attempt));
    }
  }
  return false;
}
