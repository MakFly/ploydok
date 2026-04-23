// SPDX-License-Identifier: AGPL-3.0-only
//
// Project-level runtime helpers.
//
// Each project owns its own Docker bridge network (`ploydok-proj-<id>`).
// App containers are attached to THAT network ONLY. Caddy is dynamically
// attached to every project-network on first deploy (see `caddy/attachment.ts`)
// so external traffic can still reach upstreams by `container_id:port` while
// apps from different projects share NO network and cannot discover each other
// by name — strict zero-trust by default. The pentest
// `e2e/isolation/cross-project-blocked.spec.ts` validates the invariant.

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
 * Networks a container must be attached to for a given app: **only the
 * project-network**. Caddy is attached dynamically to the same network on
 * each deploy via `ensureCaddyOnProjectNetwork`, so inbound ingress still
 * works, but apps of other projects never share a bridge.
 */
export function networksForApp(projectNetwork: string): string[] {
  return [projectNetwork];
}
