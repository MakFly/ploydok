// SPDX-License-Identifier: AGPL-3.0-only
//
// Image auto-update watch: for image-source apps that opted in via
// `track_latest`, periodically asks the agent for the current registry
// manifest digest of `image_ref`. The first observation is recorded as a
// baseline (no deploy — we don't know whether the running container matches
// it). Any later digest change triggers a redeploy through the same path as
// a manual "Deploy now" click, records an audit entry, and dispatches the
// `image.auto_updated` notification.

import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm"
import { nanoid } from "nanoid"
import { apps, builds, projects } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { getRegistryCredential } from "@ploydok/db/queries"
import type { Agent } from "../../agent"
import { childLogger } from "../../logger"
import { getSharedAgent } from "../../debug/singletons"
import { decryptField } from "../../github/app-credentials"
import { deployQueue } from "../queues"

const log = childLogger("cron.image-update-watch")

export const IMAGE_WATCH_INTERVAL_MS = 5 * 60_000
const MIN_INTERVAL_MS = 60_000

// Apps whose current deploy hasn't landed yet — never stack a second one.
const MID_DEPLOY_STATUSES = new Set(["pending", "building"])

// ---------------------------------------------------------------------------
// Candidate selection
// ---------------------------------------------------------------------------

interface ImageWatchApp {
  id: string
  name: string
  project_id: string
  owner_id: string
  status: string
  image_ref: string | null
  registry_credential_id: string | null
  last_image_digest: string | null
  pending_image_digest: string | null
}

async function fetchImageWatchCandidates(db: Db): Promise<ImageWatchApp[]> {
  return db
    .select({
      id: apps.id,
      name: apps.name,
      project_id: apps.project_id,
      owner_id: projects.owner_id,
      status: apps.status,
      image_ref: apps.image_ref,
      registry_credential_id: apps.registry_credential_id,
      last_image_digest: apps.last_image_digest,
      pending_image_digest: apps.pending_image_digest,
    })
    .from(apps)
    .innerJoin(projects, eq(apps.project_id, projects.id))
    .where(
      and(
        eq(apps.git_provider, "image"),
        eq(apps.track_latest, true),
        inArray(apps.status, ["running", "serving"]),
        isNotNull(apps.image_ref)
      )
    )
}

// ---------------------------------------------------------------------------
// Registry auth (mirrors `loadRegistryAuthForApp` in worker/handlers/deploy.ts
// — kept local since that helper isn't exported from the deploy handler).
// ---------------------------------------------------------------------------

export type RegistryAuthLoader = (
  db: Db,
  app: Pick<ImageWatchApp, "owner_id" | "registry_credential_id">
) => Promise<{ username: string; password: string } | null>

const loadImageRegistryAuthForApp: RegistryAuthLoader = async (db, app) => {
  if (!app.registry_credential_id) return null
  const row = await getRegistryCredential(
    db,
    app.owner_id,
    app.registry_credential_id
  )
  if (!row) return null
  const password = await decryptField(
    row.password_enc as Buffer,
    row.password_nonce as Buffer
  )
  return { username: row.username, password }
}

// ---------------------------------------------------------------------------
// Redeploy trigger (mirrors `POST /apps/:id/deploy` in routes/apps.ts).
// ---------------------------------------------------------------------------

export type RedeployTrigger = (params: {
  db: Db
  appId: string
  fromDigest: string
  toDigest: string
  previousStatus: string
}) => Promise<{ jobId: string }>

const triggerRedeploy: RedeployTrigger = async ({
  db,
  appId,
  fromDigest,
  toDigest,
  previousStatus,
}) => {
  const reserved = await db
    .update(apps)
    .set({
      pending_image_digest: toDigest,
      status: "pending",
      updated_at: new Date(),
    })
    .where(
      and(
        eq(apps.id, appId),
        eq(apps.track_latest, true),
        eq(apps.last_image_digest, fromDigest),
        isNull(apps.pending_image_digest)
      )
    )
    .returning({ id: apps.id })
  if (!reserved[0]) {
    throw new Error(
      "image digest changed concurrently or deploy already pending"
    )
  }

  const buildId = nanoid()
  try {
    await db.insert(builds).values({
      id: buildId,
      app_id: appId,
      source: "system",
    })
    await deployQueue.add(
      "deploy.requested",
      {
        buildId,
        imageUpdate: { fromDigest, toDigest, previousStatus },
      },
      { jobId: `deploy_${buildId}` }
    )
  } catch (err) {
    await db
      .update(builds)
      .set({
        status: "failed",
        error_message: "failed to enqueue image auto-update",
        finished_at: new Date(),
      })
      .where(eq(builds.id, buildId))
      .catch(() => undefined)
    await db
      .update(apps)
      .set({
        pending_image_digest: null,
        status: previousStatus as typeof apps.$inferSelect.status,
        updated_at: new Date(),
      })
      .where(and(eq(apps.id, appId), eq(apps.pending_image_digest, toDigest)))
    throw err
  }
  return { jobId: buildId }
}

// ---------------------------------------------------------------------------
// Tick (pure-ish, unit-testable)
// ---------------------------------------------------------------------------

export interface ImageUpdateWatchResult {
  scanned: number
  baseline: number
  updated: number
  unchanged: number
  skipped: number
}

export interface ImageUpdateWatchDeps {
  loadRegistryAuth?: RegistryAuthLoader
  enqueueDeploy?: RedeployTrigger
  now?: () => number
}

export async function runImageUpdateWatchOnce(
  db: Db,
  agent: Agent,
  deps: ImageUpdateWatchDeps = {}
): Promise<ImageUpdateWatchResult> {
  const result: ImageUpdateWatchResult = {
    scanned: 0,
    baseline: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
  }

  const loadRegistryAuth = deps.loadRegistryAuth ?? loadImageRegistryAuthForApp
  const enqueueDeploy = deps.enqueueDeploy ?? triggerRedeploy
  const now = deps.now ?? Date.now

  const candidates = await fetchImageWatchCandidates(db)
  result.scanned = candidates.length

  for (const app of candidates) {
    if (!app.image_ref) {
      result.skipped++
      continue
    }

    if (MID_DEPLOY_STATUSES.has(app.status)) {
      result.skipped++
      log.debug(
        { appId: app.id, status: app.status },
        "image-update-watch: app mid-deploy, skipping this tick"
      )
      continue
    }

    if (app.pending_image_digest) {
      result.skipped++
      continue
    }

    let digest: string
    try {
      const registryAuth = await loadRegistryAuth(db, app)
      const res = await agent.registryImageDigest({
        image: app.image_ref,
        registryAuth: registryAuth ?? undefined,
      })
      digest = res.digest
    } catch (err) {
      result.skipped++
      log.warn(
        { err, appId: app.id, image: app.image_ref },
        "image-update-watch: registry digest lookup failed"
      )
      continue
    }

    if (!digest) {
      result.skipped++
      continue
    }

    if (!app.last_image_digest) {
      await db
        .update(apps)
        .set({ last_image_digest: digest, updated_at: new Date(now()) })
        .where(eq(apps.id, app.id))
      result.baseline++
      log.info(
        { appId: app.id, digest },
        "image-update-watch: baseline digest recorded"
      )
      continue
    }

    if (digest === app.last_image_digest) {
      result.unchanged++
      continue
    }

    const oldDigest = app.last_image_digest

    try {
      await enqueueDeploy({
        db,
        appId: app.id,
        fromDigest: oldDigest,
        toDigest: digest,
        previousStatus: app.status,
      })
    } catch (err) {
      result.skipped++
      log.warn(
        { err, appId: app.id },
        "image-update-watch: redeploy enqueue failed"
      )
      continue
    }

    result.updated++
    log.info(
      { appId: app.id, oldDigest, digest },
      "image-update-watch: digest change reserved and redeploy enqueued"
    )
  }

  return result
}

// ---------------------------------------------------------------------------
// Cron lifecycle
// ---------------------------------------------------------------------------

let _timer: ReturnType<typeof setInterval> | null = null
let _running = false

async function imageUpdateWatchTick(db: Db): Promise<void> {
  if (_running) return
  _running = true
  try {
    const agent = getSharedAgent()
    const result = await runImageUpdateWatchOnce(db, agent)
    if (result.updated > 0) {
      log.info(
        result,
        "image-update-watch tick: redeployed apps with a moved digest"
      )
    } else {
      log.debug(result, "image-update-watch tick complete")
    }
  } catch (err) {
    log.warn({ err }, "image-update-watch tick failed")
  } finally {
    _running = false
  }
}

export function startImageUpdateWatchCron(db: Db): void {
  stopImageUpdateWatchCron()
  const intervalMs = Math.max(IMAGE_WATCH_INTERVAL_MS, MIN_INTERVAL_MS)
  _timer = setInterval(() => {
    void imageUpdateWatchTick(db)
  }, intervalMs)
  log.info({ intervalMs }, "image-update-watch cron scheduled")
}

export function stopImageUpdateWatchCron(): void {
  if (_timer !== null) {
    clearInterval(_timer)
    _timer = null
  }
}
