// SPDX-License-Identifier: AGPL-3.0-only
//
// Project-level runtime helpers.
//
// Each project owns its own Docker bridge network (`ploydok-proj-<id>`).
// Containers are attached to both this private network (inter-container
// isolation across projects) and the shared `ploydok-ingress` network
// (Caddy reachability). Apps of different projects cannot resolve each
// other by name — which is the pentest Phase 1.C validates.

import { eq } from "drizzle-orm";
import { projects } from "@ploydok/db";
import type { Db } from "@ploydok/db";
import { getSharedAgent } from "./debug/singletons.js";
import { childLogger } from "./logger";

type Agent = ReturnType<typeof getSharedAgent>;

const log = childLogger("projects");

/** Shared network every app is attached to so Caddy can reach them. */
export const PLOYDOK_INGRESS_NETWORK = "ploydok-ingress";

/** Legacy flat network kept for backward compat with pre-Phase-1.C apps. */
export const PLOYDOK_PUBLIC_NETWORK = "ploydok-public";

/** Derive the per-project private network name from a project id. */
export function projectNetworkName(projectId: string): string {
  // Docker network names: [a-zA-Z0-9][a-zA-Z0-9_.-]+ — our nanoid() ids are
  // safe by construction, but we lowercase defensively.
  return `ploydok-proj-${projectId.toLowerCase()}`;
}

/**
 * Ensure the per-project Docker bridge network exists and that the column
 * `projects.network_name` is populated. Idempotent: calling twice is cheap
 * (ALREADY_EXISTS from the agent is treated as success).
 *
 * Caller must pass an Agent client (or leave undefined to use the shared one).
 * Returns the final network name so callers can pass it to container create.
 */
export async function ensureProjectNetwork(
  db: Db,
  projectId: string,
  agent?: Agent,
): Promise<string> {
  const rows = await db
    .select({ network_name: projects.network_name })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error(`Project not found: ${projectId}`);

  if (row.network_name) return row.network_name;

  const agentClient = agent ?? getSharedAgent();
  const name = projectNetworkName(projectId);
  try {
    await agentClient.networkCreate({
      name,
      driver: "bridge",
      labels: { "ploydok.kind": "project-network", "ploydok.project_id": projectId },
    });
    log.info({ projectId, name }, "project network created");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("already exists") || msg.includes("ALREADY_EXISTS")) {
      log.info({ projectId, name }, "project network already exists");
    } else {
      throw err;
    }
  }

  await db.update(projects).set({ network_name: name }).where(eq(projects.id, projectId));
  return name;
}

/**
 * Networks a container must be attached to for a given app:
 *   [projectNetwork, ingressNetwork]
 * The Rust agent iterates both and wires them via bollard's EndpointsConfig.
 */
export function networksForApp(projectNetwork: string): string[] {
  return [projectNetwork, PLOYDOK_INGRESS_NETWORK];
}
