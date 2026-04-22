// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Core backup orchestration for managed databases.
 *
 * Flow:
 *  1. Load database + config rows.
 *  2. Insert a "running" backups row.
 *  3. Call agent DumpDatabase (server-streaming).
 *  4. Upload chunks to S3 or write to local filesystem.
 *  5. Update backups row to succeeded/failed.
 *  6. Delete backups older than retention_days.
 *  7. Update backup_configs.last_run_at + last_error.
 */
import { mkdir, open } from "node:fs/promises"
import path from "node:path"
import { PassThrough, Readable } from "node:stream"
import { nanoid } from "nanoid"
import { and, eq, lt } from "drizzle-orm"
import { databases, backup_configs, backups, secrets } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { decryptSecret } from "../secrets/crypto"
import { getSharedAgent } from "../debug/singletons"
import { createS3Client, uploadStream, deleteObject, listObjects } from "../storage/s3"
import { childLogger } from "../logger"
import { env } from "../env"

const log = childLogger("databases.backup")

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackupRunResult {
  backupId: string
  status: "succeeded" | "failed"
  sizeBytes: number
  location: string
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runBackupOnce(db: Db, databaseId: string): Promise<BackupRunResult> {
  const bkLog = log.child({ databaseId })

  // 1. Load database + backup_config
  const dbRows = await db
    .select()
    .from(databases)
    .where(eq(databases.id, databaseId))
    .limit(1)
  const dbRow = dbRows[0]
  if (!dbRow) throw new Error(`Database not found: ${databaseId}`)
  if (!dbRow.container_id) throw new Error(`Database ${databaseId} has no container_id`)

  const configRows = await db
    .select()
    .from(backup_configs)
    .where(and(eq(backup_configs.database_id, databaseId), eq(backup_configs.enabled, true)))
    .limit(1)
  const config = configRows[0]
  if (!config) throw new Error(`No enabled backup config for database ${databaseId}`)

  // 2. Insert backups row with status=running
  const backupId = nanoid()
  const startedAt = new Date()
  const ageEncrypted = Boolean(config.age_recipient_public_key)

  // Determine location
  const ts = startedAt.toISOString().replace(/[:.]/g, "-")
  const filename = `${ts}.dump${ageEncrypted ? ".age" : ""}`
  let location: string
  if (config.destination_kind === "s3") {
    const prefix = config.s3_prefix ? `${config.s3_prefix.replace(/\/$/, "")}/` : ""
    location = `s3://${config.s3_bucket}/${prefix}${databaseId}/${filename}`
  } else {
    location = path.join(env.PLOYDOK_BUILD_DIR ?? "/tmp/ploydok-dev/builds", "..", "backups", databaseId, filename)
  }

  await db.insert(backups).values({
    id: backupId,
    database_id: databaseId,
    config_id: config.id,
    destination_kind: config.destination_kind as "s3" | "local",
    location,
    age_encrypted: ageEncrypted,
    status: "running",
    started_at: startedAt,
  })

  let sizeBytes = 0
  let error: string | undefined

  try {
    // 3. Stream dump from agent
    const agent = getSharedAgent()
    const dumpStream = agent.dumpDatabase({
      containerId: dbRow.container_id,
      kind: dbRow.kind,
      ageRecipient: config.age_recipient_public_key ?? "",
    })

    // Build a Node.js Readable from the async iterable of DumpChunks
    const passThrough = new PassThrough()

    // Pipe chunks asynchronously
    const feedPromise = (async () => {
      for await (const chunk of dumpStream) {
        if (chunk.data.length > 0) {
          sizeBytes += chunk.data.length
          passThrough.push(Buffer.from(chunk.data))
        }
      }
      passThrough.push(null)
    })()

    // 4. Upload or write
    if (config.destination_kind === "s3") {
      const s3Creds = await resolveS3Credentials(db, config)
      const client = createS3Client({
        ...(config.s3_endpoint ? { endpoint: config.s3_endpoint } : {}),
        region: config.s3_region ?? "auto",
        accessKeyId: s3Creds.accessKeyId,
        secretAccessKey: s3Creds.secretAccessKey,
      })
      const prefix = config.s3_prefix ? `${config.s3_prefix.replace(/\/$/, "")}/` : ""
      const key = `${prefix}${databaseId}/${filename}`
      await uploadStream(client, config.s3_bucket!, key, passThrough)
      await feedPromise
    } else {
      // Local write
      const dir = path.dirname(location)
      await mkdir(dir, { recursive: true })
      const fh = await open(location, "w")
      await feedPromise
      const readableForFile = Readable.from(passThrough)
      await new Promise<void>((resolve, reject) => {
        readableForFile.pipe(fh.createWriteStream())
        readableForFile.on("end", () => fh.close().then(resolve).catch(reject))
        readableForFile.on("error", reject)
      })
    }

    bkLog.info({ backupId, location, sizeBytes }, "backup completed")
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
    bkLog.error({ backupId, err }, "backup failed")
  }

  // 5. Update backups row
  const status = error ? "failed" : "succeeded"
  await db
    .update(backups)
    .set({ status, error: error ?? null, size_bytes: sizeBytes, finished_at: new Date() })
    .where(eq(backups.id, backupId))

  // 6. Delete backups older than retention_days
  await purgeOldBackups(db, databaseId, config.id, config.retention_days, config.destination_kind as "s3" | "local", config)

  // 7. Update config last_run_at + last_error
  await db
    .update(backup_configs)
    .set({ last_run_at: new Date(), last_error: error ?? null })
    .where(eq(backup_configs.id, config.id))

  return { backupId, status, sizeBytes, location }
}

// ---------------------------------------------------------------------------
// Retention purge
// ---------------------------------------------------------------------------

async function purgeOldBackups(
  db: Db,
  databaseId: string,
  configId: string,
  retentionDays: number,
  kind: "s3" | "local",
  config: typeof backup_configs.$inferSelect,
): Promise<void> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)

  const old = await db
    .select()
    .from(backups)
    .where(
      and(
        eq(backups.database_id, databaseId),
        eq(backups.config_id, configId),
        lt(backups.started_at, cutoff),
      ),
    )

  for (const backup of old) {
    try {
      if (kind === "s3" && backup.location.startsWith("s3://")) {
        const creds = await resolveS3Credentials(db, config)
        const client = createS3Client({
          ...(config.s3_endpoint ? { endpoint: config.s3_endpoint } : {}),
          region: config.s3_region ?? "auto",
          accessKeyId: creds.accessKeyId,
          secretAccessKey: creds.secretAccessKey,
        })
        // Parse s3://bucket/key
        const url = new URL(backup.location)
        const bucket = url.hostname
        const key = url.pathname.replace(/^\//, "")
        await deleteObject(client, bucket, key)
      } else if (kind === "local") {
        const { unlink } = await import("node:fs/promises")
        await unlink(backup.location).catch(() => {})
      }
    } catch (err) {
      log.warn({ err, backupId: backup.id }, "failed to delete old backup object (non-fatal)")
    }

    await db.delete(backups).where(eq(backups.id, backup.id))
  }

  if (old.length > 0) {
    log.info({ databaseId, purged: old.length, cutoff }, "old backups purged")
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface S3Credentials {
  accessKeyId: string
  secretAccessKey: string
}

async function resolveS3Credentials(db: Db, config: typeof backup_configs.$inferSelect): Promise<S3Credentials> {
  if (!config.s3_credentials_secret_id) {
    throw new Error("S3 backup config is missing s3_credentials_secret_id")
  }

  const secretRows = await db
    .select()
    .from(secrets)
    .where(eq(secrets.id, config.s3_credentials_secret_id))
    .limit(1)
  const secret = secretRows[0]
  if (!secret || !secret.value_ciphertext || !secret.nonce) {
    throw new Error("S3 credentials secret not found or missing ciphertext")
  }

  const plaintext = await decryptSecret(
    secret.value_ciphertext as Buffer,
    secret.nonce as Buffer,
  )

  // Expected format: JSON { accessKeyId, secretAccessKey }
  const creds = JSON.parse(plaintext) as S3Credentials
  if (!creds.accessKeyId || !creds.secretAccessKey) {
    throw new Error("S3 credentials secret has unexpected format (expected { accessKeyId, secretAccessKey })")
  }
  return creds
}
