// SPDX-License-Identifier: AGPL-3.0-only
import { and, eq, inArray } from "drizzle-orm"
import { nanoid } from "nanoid"
import { apps, build_scans, builds, projects } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { getRegistryCredential } from "@ploydok/db/queries"
import { decryptField } from "../../github/app-credentials"
import { childLogger } from "../../logger"
import { imageScanQueue } from "../queues"
import { scanImage } from "../trivy"

const log = childLogger("scan.image")

export interface ImageScanPayload {
  scanId: string
}

export async function enqueueImageScan(
  db: Db,
  input: { buildId: string; imageRef: string }
): Promise<string> {
  const scanId = nanoid()
  const rows = await db
    .insert(build_scans)
    .values({
      id: scanId,
      build_id: input.buildId,
      image_ref: input.imageRef,
      status: "pending",
    })
    .onConflictDoNothing({ target: build_scans.build_id })
    .returning({ id: build_scans.id })

  const persistedId = rows[0]?.id
  if (!persistedId) {
    const existing = await db
      .select({ id: build_scans.id })
      .from(build_scans)
      .where(eq(build_scans.build_id, input.buildId))
      .limit(1)
    return existing[0]!.id
  }

  try {
    await imageScanQueue.add(
      "scan.image.requested",
      { scanId: persistedId } satisfies ImageScanPayload,
      { jobId: `scan_${persistedId}` }
    )
  } catch (err) {
    await db
      .update(build_scans)
      .set({
        status: "failed",
        error_message: "failed to enqueue image scan",
        scanned_at: new Date(),
      })
      .where(eq(build_scans.id, persistedId))
    throw err
  }

  return persistedId
}

async function loadRegistryAuth(db: Db, scanId: string) {
  const rows = await db
    .select({
      credentialId: apps.registry_credential_id,
      ownerId: projects.owner_id,
    })
    .from(build_scans)
    .innerJoin(builds, eq(build_scans.build_id, builds.id))
    .innerJoin(apps, eq(builds.app_id, apps.id))
    .innerJoin(projects, eq(apps.project_id, projects.id))
    .where(eq(build_scans.id, scanId))
    .limit(1)
  const row = rows[0]
  if (!row?.credentialId) return undefined

  const credential = await getRegistryCredential(
    db,
    row.ownerId,
    row.credentialId
  )
  if (!credential) return undefined
  return {
    username: credential.username,
    password: await decryptField(
      credential.password_enc as Buffer,
      credential.password_nonce as Buffer
    ),
  }
}

export async function handleImageScan(
  db: Db,
  payload: ImageScanPayload
): Promise<void> {
  const now = new Date()
  const claimed = await db
    .update(build_scans)
    .set({ status: "running", started_at: now, error_message: null })
    .where(
      and(
        eq(build_scans.id, payload.scanId),
        inArray(build_scans.status, ["pending", "running"])
      )
    )
    .returning()

  const scan = claimed[0]
  if (!scan?.image_ref) {
    log.warn(
      { scanId: payload.scanId },
      "image scan row missing or already terminal"
    )
    return
  }

  const registryAuth = await loadRegistryAuth(db, payload.scanId)
  const result = await scanImage(scan.image_ref, registryAuth)
  await db
    .update(build_scans)
    .set({
      status: result.status,
      critical: result.counts.critical,
      high: result.counts.high,
      medium: result.counts.medium,
      low: result.counts.low,
      unknown: result.counts.unknown,
      error_message: result.error?.slice(0, 1000) ?? null,
      scanned_at: new Date(),
    })
    .where(eq(build_scans.id, payload.scanId))
}
