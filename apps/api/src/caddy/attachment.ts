// SPDX-License-Identifier: AGPL-3.0-only
//
// Caddy ↔ project-network attachment.
//
// Zero-trust by default: app containers only live on their project-network
// (`ploydok-proj-<id>`). Caddy is attached dynamically to each project-network
// that has at least one app so it can reach upstreams by container_id while
// remaining the single external ingress. Containers of different projects
// therefore share NO network and cannot reach each other.

import { and, eq, inArray, isNotNull } from "drizzle-orm"
import { apps as appsTable, projects as projectsTable } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import type { Agent } from "../agent"
import { isAlreadyExists, isNotFound, toAgentError } from "../agent/index.js"
import { childLogger } from "../logger"

const log = childLogger("caddy-attach")

/**
 * Name of the Caddy container spawned by `infra/docker-compose.yml`. The
 * compose `container_name` is set to `ploydok-caddy`, but docker-compose also
 * accepts the default `<project>-<service>-1` pattern. We match both.
 */
const CADDY_CONTAINER_NAMES = ["ploydok-caddy", "ploydok-caddy-1"] as const

/**
 * Lazy cache for the Caddy container id. Docker does not re-allocate an id
 * while the container is alive; we only refresh it if a `network_connect`
 * fails with NOT_FOUND (the container was recreated).
 */
let cachedCaddyId: string | null = null

/** Reset the cache — exposed for tests or post-restart reconciliation. */
export function resetCaddyIdCache(): void {
  cachedCaddyId = null
}

async function resolveCaddyContainerId(agent: Agent): Promise<string> {
  if (cachedCaddyId) return cachedCaddyId
  const { containers } = await agent.listContainers({ kindFilter: "" })
  for (const candidate of CADDY_CONTAINER_NAMES) {
    const match = containers.find((c) => c.name === candidate || c.name === `/${candidate}`)
    if (match) {
      cachedCaddyId = match.id
      log.debug({ caddyId: match.id, name: match.name }, "resolved caddy container")
      return match.id
    }
  }
  throw new Error(
    `caddy container not found (expected one of ${CADDY_CONTAINER_NAMES.join(", ")}). ` +
      `Is 'make infra-up' running?`,
  )
}

/**
 * Ensure Caddy is attached to `projectNetwork`. Idempotent: treats Docker's
 * 409 "already exists" as success. Safe to call on every deploy.
 */
export async function ensureCaddyOnProjectNetwork(
  agent: Agent,
  projectNetwork: string,
): Promise<void> {
  const caddyId = await resolveCaddyContainerId(agent)
  try {
    await agent.networkConnect({
      networkId: projectNetwork,
      containerId: caddyId,
      aliases: [],
    })
    log.info({ projectNetwork, caddyId }, "caddy attached to project network")
  } catch (err) {
    const agentErr = toAgentError(err)
    if (isAlreadyExists(agentErr)) {
      log.debug({ projectNetwork, caddyId }, "caddy already on project network")
      return
    }
    // NOT_FOUND on the container id almost always means Caddy was recreated
    // (compose down/up). Invalidate the cache and retry once.
    if (isNotFound(agentErr) && /container/i.test(agentErr.details)) {
      resetCaddyIdCache()
      const freshId = await resolveCaddyContainerId(agent)
      await agent.networkConnect({
        networkId: projectNetwork,
        containerId: freshId,
        aliases: [],
      })
      log.info({ projectNetwork, caddyId: freshId }, "caddy re-attached after cache refresh")
      return
    }
    throw err
  }
}

/**
 * Detach Caddy from `projectNetwork`. Called at project deletion right before
 * `network_remove` (Docker refuses to delete a network with active endpoints).
 * Idempotent: missing endpoint / missing network are non-fatal.
 */
export async function detachCaddyFromProjectNetwork(
  agent: Agent,
  projectNetwork: string,
): Promise<void> {
  let caddyId: string
  try {
    caddyId = await resolveCaddyContainerId(agent)
  } catch {
    // Caddy itself is gone — nothing to do.
    return
  }
  try {
    await agent.networkDisconnect({
      networkId: projectNetwork,
      containerId: caddyId,
      force: true,
    })
    log.info({ projectNetwork, caddyId }, "caddy detached from project network")
  } catch (err) {
    if (isNotFound(toAgentError(err))) {
      log.debug({ projectNetwork }, "caddy not on project network — nothing to detach")
      return
    }
    throw err
  }
}

/**
 * Boot-time reconciliation: ensure Caddy is attached to every project-network
 * that hosts at least one `running` or `restarting` app. Called from
 * `bootInfra` after the caddy route reconciliation so live apps remain
 * reachable across API/Caddy restarts without waiting for the next deploy.
 */
export async function reconcileCaddyAttachments(
  agent: Agent,
  db: Db,
): Promise<{ attached: number; skipped: number; failed: number }> {
  const rows = await db
    .selectDistinct({ network_name: projectsTable.network_name })
    .from(projectsTable)
    .innerJoin(appsTable, eq(appsTable.project_id, projectsTable.id))
    .where(
      and(
        isNotNull(projectsTable.network_name),
        inArray(appsTable.status, ["running", "restarting"]),
      ),
    )
  const result = { attached: 0, skipped: 0, failed: 0 }
  for (const row of rows) {
    const name = row.network_name
    if (!name) {
      result.skipped++
      continue
    }
    try {
      await ensureCaddyOnProjectNetwork(agent, name)
      result.attached++
    } catch (err) {
      log.warn({ err, projectNetwork: name }, "reconcile: caddy attach failed")
      result.failed++
    }
  }
  log.info(result, "caddy attachments reconciled")
  return result
}
