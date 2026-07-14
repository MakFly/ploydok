// SPDX-License-Identifier: AGPL-3.0-only
//
// One-shot migration — move existing app containers from the shared
// `ploydok-ingress` network to strict project-only isolation.
//
// Before: app containers attached to [ploydok-proj-<id>, ploydok-ingress].
//         Apps from different projects could reach each other on ingress.
// After:  app containers attached to [ploydok-proj-<id>] ONLY.
//         Caddy is attached on-demand to every project-network; external
//         ingress continues to route by `container_id:port`, unchanged.
//
// Zero-downtime because Caddy routes upstreams by container_id (stable across
// network reshuffling). Idempotent: re-running is safe.
//
// Usage:
//   set -a && . apps/api/.env.local && set +a
//   bun run scripts/migrate-network-isolation.ts
import postgres from "postgres"
import { Agent, isNotFound } from "../apps/api/src/agent/index.js"
import {
  ensureCaddyOnProjectNetwork,
  detachCaddyFromProjectNetwork,
} from "../apps/api/src/caddy/attachment.js"

const DB_URL = Bun.env["DATABASE_URL"]
if (!DB_URL) {
  console.error("DATABASE_URL not set — source apps/api/.env.local first")
  process.exit(1)
}

const LEGACY_INGRESS = "ploydok-ingress"
const sql = postgres(DB_URL, { max: 2 })
const agent = new Agent()

type ContainerSnapshot = { id: string; name: string }

async function listAppContainers(): Promise<Array<ContainerSnapshot>> {
  const { containers } = await agent.listContainers({ kindFilter: "" })
  return containers
    .filter((c) => c.kind === "app" && c.status === "running")
    .map((c) => ({ id: c.id, name: c.name }))
}

async function main(): Promise<void> {
  const summary = { attached: 0, detached: 0, skipped: 0, failed: 0 }

  const appsRows = await sql<
    Array<{
      id: string
      container_id: string | null
      project_id: string
      network_name: string | null
    }>
  >`
    SELECT a.id, a.container_id, a.project_id, p.network_name
    FROM apps a
    JOIN projects p ON p.id = a.project_id
  `

  console.log(`[migrate] found ${appsRows.length} apps to inspect`)

  // 1. Ensure Caddy is attached to every project network that has >= 1 app.
  const projectNetworks = new Set(
    appsRows.map((r) => r.network_name).filter((n): n is string => !!n)
  )
  for (const projectNetwork of projectNetworks) {
    try {
      await ensureCaddyOnProjectNetwork(agent, projectNetwork)
      summary.attached++
    } catch (err) {
      console.warn(`[migrate] attach caddy → ${projectNetwork} failed:`, err)
      summary.failed++
    }
  }

  if (summary.failed > 0) {
    console.error(
      "[migrate] aborting before detach: Caddy is not attached to every project network",
      summary
    )
    agent.close()
    await sql.end()
    process.exit(1)
  }

  // 2. Detach every app container from the legacy `ploydok-ingress` network.
  const containers = await listAppContainers()
  for (const c of containers) {
    try {
      await agent.networkDisconnect({
        networkId: LEGACY_INGRESS,
        containerId: c.id,
        force: false,
      })
      console.log(`[migrate] ${c.name} detached from ${LEGACY_INGRESS}`)
      summary.detached++
    } catch (err) {
      if (isNotFound(err)) {
        console.log(
          `[migrate] ${c.name} not on ${LEGACY_INGRESS} (already migrated)`
        )
        summary.skipped++
        continue
      }
      console.warn(`[migrate] detach ${c.name} failed:`, err)
      summary.failed++
    }
  }

  // 3. Also detach Caddy from the legacy ingress — it no longer needs to route
  //    there. Safe to leave otherwise; keep idempotent.
  try {
    await detachCaddyFromProjectNetwork(agent, LEGACY_INGRESS)
    console.log(`[migrate] caddy detached from ${LEGACY_INGRESS}`)
  } catch (err) {
    console.warn(`[migrate] detach caddy from ${LEGACY_INGRESS} failed:`, err)
  }

  console.log("[migrate] done", summary)
  agent.close()
  await sql.end()
  process.exit(summary.failed > 0 ? 1 : 0)
}

await main()
