// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Delete-app cascade handler — Coolify-style.
 *
 * Steps performed (each one best-effort, all errors collected and surfaced):
 *  1. Stop both blue/green containers + remove their Docker objects.
 *  2. Wipe registry images (manifests with keepPerRepo=0) + reclaim blobs.
 *  3. Remove Caddy upstream/route for the app.
 *  4. Delete on-disk build workspaces (~/.ploydok-dev/builds/<appId>/).
 *  5. Delete the `apps` row — `builds`, `domains`, `env_vars` cascade via FK.
 *
 * Triggered by job `app.delete.requested`. Each option flag mirrors the
 * Coolify API (`delete_volumes`, `docker_cleanup`, `delete_configurations`,
 * `delete_connected_networks`).
 */
import path from "node:path";
import { rm } from "node:fs/promises";
import { and, eq, ne } from "drizzle-orm";
import { apps, projects } from "@ploydok/db";
import type { Db } from "@ploydok/db";
import { env } from "../../env";
import { workerLog as logger } from "../logger";
import { CaddyClient } from "../../caddy/client.js";
import { getSharedAgent } from "../../debug/singletons.js";
import { runRegistryGc } from "./gc-registry.js";

export interface DeleteAppOptions {
  appId: string;
  /** Wipe registry images + blobs. Default true. */
  deleteImages?: boolean;
  /** Stop + force-remove the Docker containers. Default true. */
  dockerCleanup?: boolean;
  /** Remove the on-disk build workspace. Default true. */
  deleteBuildArtifacts?: boolean;
  /** Remove the Caddy upstream + route. Default true. */
  deleteCaddyRoutes?: boolean;
  /** Override Caddy admin URL (tests). */
  caddyBaseUrl?: string;
  /** Override agent socket path (tests). */
  agentSocketPath?: string;
}

export interface DeleteAppResult {
  appId: string;
  steps: {
    containers: { ok: boolean; error?: string };
    registry: { ok: boolean; tagsDeleted: number; error?: string };
    caddy: { ok: boolean; error?: string };
    buildArtifacts: { ok: boolean; error?: string };
    dbCascade: { ok: boolean; error?: string };
  };
}

const log = logger.child({ handler: "delete-app" });

function errToString(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Run the full delete cascade. Always attempts every step even if a previous
 * one fails — partial cleanup is better than none. Reports per-step status.
 */
export async function handleDeleteApp(
  db: Db,
  opts: DeleteAppOptions,
): Promise<DeleteAppResult> {
  const {
    appId,
    deleteImages = true,
    dockerCleanup = true,
    deleteBuildArtifacts = true,
    deleteCaddyRoutes = true,
    caddyBaseUrl,
    agentSocketPath,
  } = opts;

  const result: DeleteAppResult = {
    appId,
    steps: {
      containers: { ok: true },
      registry: { ok: true, tagsDeleted: 0 },
      caddy: { ok: true },
      buildArtifacts: { ok: true },
      dbCascade: { ok: true },
    },
  };

  log.info({ appId, opts }, "delete-app cascade started");

  // 1. Stop + remove containers (blue/green).
  if (dockerCleanup) {
    try {
      const { stopApp } = await import("../runner.js");
      const stopOpts: { agentSocketPath?: string; caddyBaseUrl?: string } = {};
      if (agentSocketPath) stopOpts.agentSocketPath = agentSocketPath;
      if (caddyBaseUrl) stopOpts.caddyBaseUrl = caddyBaseUrl;
      await stopApp(appId, db, stopOpts);
    } catch (err) {
      result.steps.containers = { ok: false, error: errToString(err) };
      log.warn({ appId, err }, "container cleanup failed (continuing)");
    }
  }

  // 2. Registry: wipe all manifests for this app + reclaim blobs.
  if (deleteImages) {
    try {
      const gc = await runRegistryGc({ db, appFilter: appId, keepPerRepo: 0 });
      result.steps.registry = { ok: true, tagsDeleted: gc.tagsDeleted };
    } catch (err) {
      result.steps.registry = {
        ok: false,
        tagsDeleted: 0,
        error: errToString(err),
      };
      log.warn({ appId, err }, "registry cleanup failed (continuing)");
    }
  }

  // 3. Caddy: delete upstream/route. (stopApp already calls removeUpstream
  //    when dockerCleanup ran — this is the explicit fallback for the case
  //    where containers were skipped or stopApp failed before reaching it.)
  if (deleteCaddyRoutes && !dockerCleanup) {
    try {
      const caddy = new CaddyClient(caddyBaseUrl);
      await caddy.removeRoute(appId);
    } catch (err) {
      result.steps.caddy = { ok: false, error: errToString(err) };
      log.warn({ appId, err }, "caddy cleanup failed (continuing)");
    }
  }

  // 4. Build artifacts on disk.
  if (deleteBuildArtifacts) {
    try {
      const dir = path.join(env.PLOYDOK_BUILD_DIR, appId);
      await rm(dir, { recursive: true, force: true });
    } catch (err) {
      result.steps.buildArtifacts = { ok: false, error: errToString(err) };
      log.warn({ appId, err }, "build-artifacts cleanup failed (continuing)");
    }
  }

  // 4b. Per-project network cleanup (Phase 1.C).
  //
  // Before deleting the `apps` row we check whether this is the last app of
  // its project. If so and the project has a network_name set, drop the
  // Docker bridge network. Best-effort: failures are non-fatal.
  try {
    const [appRow] = await db
      .select({ project_id: apps.project_id })
      .from(apps)
      .where(eq(apps.id, appId))
      .limit(1);

    if (appRow) {
      const siblings = await db
        .select({ id: apps.id })
        .from(apps)
        .where(and(eq(apps.project_id, appRow.project_id), ne(apps.id, appId)))
        .limit(1);

      if (siblings.length === 0) {
        const [projRow] = await db
          .select({ network_name: projects.network_name })
          .from(projects)
          .where(eq(projects.id, appRow.project_id))
          .limit(1);

        if (projRow?.network_name) {
          try {
            const agent = getSharedAgent();
            await agent.networkRemove({ networkId: projRow.network_name });
            await db
              .update(projects)
              .set({ network_name: null })
              .where(eq(projects.id, appRow.project_id));
            log.info(
              { appId, projectId: appRow.project_id, network: projRow.network_name },
              "project network removed (last app deleted)",
            );
          } catch (err) {
            log.warn(
              { appId, projectId: appRow.project_id, err },
              "networkRemove failed (non-fatal)",
            );
          }
        }
      }
    }
  } catch (err) {
    log.warn({ appId, err }, "project-network cleanup check failed (non-fatal)");
  }

  // 5. DB cascade: deleting the apps row removes builds/env_vars/domains
  //    via the existing FK constraints (onDelete: 'cascade').
  try {
    await db.delete(apps).where(eq(apps.id, appId));
  } catch (err) {
    result.steps.dbCascade = { ok: false, error: errToString(err) };
    log.error({ appId, err }, "db cascade delete failed");
  }

  log.info({ appId, result }, "delete-app cascade finished");
  return result;
}
