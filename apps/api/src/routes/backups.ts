// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono"
import { z } from "zod"
import { and, eq, desc } from "drizzle-orm"
import { databases, backup_configs, backups, projects } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { nanoid } from "nanoid"
import { requireTotpVerified } from "../auth/second-factor"
import { runBackupOnce } from "../databases/backup"
import { runRestore } from "../databases/restore"
import { childLogger } from "../logger"
import type { AuthUser } from "../auth/middleware"

const log = childLogger("backups.routes")

type AppEnv = { Variables: { user?: AuthUser } }

function getUser(c: { get: (k: string) => unknown }): AuthUser {
  return c.get("user") as AuthUser
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const BackupConfigBody = z.object({
  destinationKind: z.enum(["s3", "local"]).optional(),
  s3Endpoint: z.string().optional(),
  s3Bucket: z.string().optional(),
  s3Prefix: z.string().optional(),
  s3Region: z.string().optional(),
  s3CredentialsSecretId: z.string().optional(),
  scheduleCron: z.string().min(9).max(100).optional(),
  retentionDays: z.number().int().min(1).max(365).optional(),
  ageRecipientPublicKey: z.string().max(200).optional().nullable(),
  enabled: z.boolean().optional(),
})

const RestoreBody = z.object({
  backupId: z.string().min(1),
  ageIdentity: z.string().optional(),
  confirm: z.string().min(1),
})

// ---------------------------------------------------------------------------
// Ownership helper
// ---------------------------------------------------------------------------

async function getDbForUser(db: Db, dbId: string, userId: string) {
  const rows = await db
    .select({ db: databases })
    .from(databases)
    .innerJoin(projects, eq(databases.project_id, projects.id))
    .where(and(eq(databases.id, dbId), eq(projects.owner_id, userId)))
    .limit(1)
  return rows[0]?.db ?? null
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createBackupsRouter(db: Db): Hono<any, any, any> {
  const router = new Hono<AppEnv>()
  const totpMiddleware = requireTotpVerified(db)

  // GET /databases/:id/backups
  router.get("/databases/:id/backups", async (c) => {
    const user = getUser(c)
    const dbId = c.req.param("id")

    const dbRow = await getDbForUser(db, dbId, user.id)
    if (!dbRow) return c.json({ error: { code: "NOT_FOUND", message: "Database not found" } }, 404)

    const rows = await db
      .select()
      .from(backups)
      .where(eq(backups.database_id, dbId))
      .orderBy(desc(backups.started_at))
      .limit(50)

    return c.json({ backups: rows.map(serializeBackup) })
  })

  // GET /databases/:id/backup-config
  router.get("/databases/:id/backup-config", async (c) => {
    const user = getUser(c)
    const dbId = c.req.param("id")

    const dbRow = await getDbForUser(db, dbId, user.id)
    if (!dbRow) return c.json({ error: { code: "NOT_FOUND", message: "Database not found" } }, 404)

    const configRows = await db
      .select()
      .from(backup_configs)
      .where(eq(backup_configs.database_id, dbId))
      .limit(1)

    if (!configRows[0]) {
      return c.json({ config: null })
    }
    return c.json({ config: serializeConfig(configRows[0]) })
  })

  // PUT /databases/:id/backup-config
  router.put("/databases/:id/backup-config", async (c) => {
    const user = getUser(c)
    const dbId = c.req.param("id")

    const dbRow = await getDbForUser(db, dbId, user.id)
    if (!dbRow) return c.json({ error: { code: "NOT_FOUND", message: "Database not found" } }, 404)

    const body = await c.req.json().catch(() => null)
    const parsed = BackupConfigBody.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.message } }, 400)
    }

    const data = parsed.data
    const existing = await db
      .select()
      .from(backup_configs)
      .where(eq(backup_configs.database_id, dbId))
      .limit(1)

    const updateFields = {
      ...(data.destinationKind !== undefined && { destination_kind: data.destinationKind }),
      ...(data.s3Endpoint !== undefined && { s3_endpoint: data.s3Endpoint }),
      ...(data.s3Bucket !== undefined && { s3_bucket: data.s3Bucket }),
      ...(data.s3Prefix !== undefined && { s3_prefix: data.s3Prefix }),
      ...(data.s3Region !== undefined && { s3_region: data.s3Region }),
      ...(data.s3CredentialsSecretId !== undefined && { s3_credentials_secret_id: data.s3CredentialsSecretId }),
      ...(data.scheduleCron !== undefined && { schedule_cron: data.scheduleCron }),
      ...(data.retentionDays !== undefined && { retention_days: data.retentionDays }),
      ...(data.ageRecipientPublicKey !== undefined && { age_recipient_public_key: data.ageRecipientPublicKey }),
      ...(data.enabled !== undefined && { enabled: data.enabled }),
    }

    if (existing[0]) {
      await db
        .update(backup_configs)
        .set(updateFields)
        .where(eq(backup_configs.id, existing[0].id))
      const updated = await db
        .select()
        .from(backup_configs)
        .where(eq(backup_configs.id, existing[0].id))
        .limit(1)
      return c.json({ config: serializeConfig(updated[0]!) })
    }

    // Create new config
    const id = nanoid()
    await db.insert(backup_configs).values({
      id,
      database_id: dbId,
      destination_kind: data.destinationKind ?? "local",
      s3_endpoint: data.s3Endpoint,
      s3_bucket: data.s3Bucket,
      s3_prefix: data.s3Prefix,
      s3_region: data.s3Region,
      s3_credentials_secret_id: data.s3CredentialsSecretId,
      schedule_cron: data.scheduleCron ?? "0 3 * * *",
      retention_days: data.retentionDays ?? 7,
      age_recipient_public_key: data.ageRecipientPublicKey ?? null,
      enabled: data.enabled ?? true,
    })
    const created = await db
      .select()
      .from(backup_configs)
      .where(eq(backup_configs.id, id))
      .limit(1)
    return c.json({ config: serializeConfig(created[0]!) }, 201)
  })

  // POST /databases/:id/backup-now
  router.post("/databases/:id/backup-now", async (c) => {
    const user = getUser(c)
    const dbId = c.req.param("id")

    const dbRow = await getDbForUser(db, dbId, user.id)
    if (!dbRow) return c.json({ error: { code: "NOT_FOUND", message: "Database not found" } }, 404)

    log.info({ databaseId: dbId, userId: user.id }, "manual backup requested")

    // Run asynchronously — return immediately with the backup id
    const backupId = nanoid()

    void (async () => {
      try {
        await runBackupOnce(db, dbId)
      } catch (err) {
        log.error({ err, databaseId: dbId }, "manual backup failed")
      }
    })()

    return c.json({ message: "Backup enqueued", backupId }, 202)
  })

  // POST /databases/:id/restore — TOTP required
  router.post("/databases/:id/restore", totpMiddleware, async (c) => {
    const user = getUser(c)
    const dbId = c.req.param("id")

    const dbRow = await getDbForUser(db, dbId!, user.id)
    if (!dbRow) return c.json({ error: { code: "NOT_FOUND", message: "Database not found" } }, 404)

    const body = await c.req.json().catch(() => null)
    const parsed = RestoreBody.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.message } }, 400)
    }

    const { backupId, ageIdentity, confirm } = parsed.data

    // Challenge: user must type "restore <db_name>"
    const expected = `restore ${dbRow.name}`
    if (confirm !== expected) {
      return c.json(
        { error: { code: "CONFIRM_MISMATCH", message: `Type exactly "${expected}" to confirm restore` } },
        400,
      )
    }

    log.warn({ databaseId: dbId, backupId, userId: user.id }, "restore initiated")

    try {
      const result = await runRestore(db, { backupId, ...(ageIdentity ? { ageIdentity } : {}) })
      if (!result.ok) {
        return c.json({ error: { code: "RESTORE_FAILED", message: result.error ?? "restore failed" } }, 500)
      }
      return c.json({ ok: true })
    } catch (err) {
      log.error({ err, databaseId: dbId, backupId }, "restore error")
      return c.json({ error: { code: "RESTORE_FAILED", message: "Restore failed" } }, 500)
    }
  })

  // DELETE /backups/:backupId
  router.delete("/backups/:backupId", async (c) => {
    const user = getUser(c)
    const backupId = c.req.param("backupId")

    // Load backup and verify ownership
    const backupRows = await db
      .select({ backup: backups, db: databases })
      .from(backups)
      .innerJoin(databases, eq(backups.database_id, databases.id))
      .innerJoin(projects, eq(databases.project_id, projects.id))
      .where(and(eq(backups.id, backupId), eq(projects.owner_id, user.id)))
      .limit(1)

    const row = backupRows[0]
    if (!row) return c.json({ error: { code: "NOT_FOUND", message: "Backup not found" } }, 404)

    // Try to delete underlying object (best-effort)
    if (row.backup.location.startsWith("s3://")) {
      // Load config for credentials
      try {
        const { deleteObject: s3Delete } = await import("../storage/s3")
        const { createS3Client: mkClient } = await import("../storage/s3")
        if (row.backup.config_id) {
          const configRows = await db
            .select()
            .from(backup_configs)
            .where(eq(backup_configs.id, row.backup.config_id))
            .limit(1)
          const cfg = configRows[0]
          if (cfg?.s3_credentials_secret_id) {
            const { secrets: secretsTable } = await import("@ploydok/db")
            const secretRows = await db
              .select()
              .from(secretsTable)
              .where(eq(secretsTable.id, cfg.s3_credentials_secret_id))
              .limit(1)
            const s = secretRows[0]
            if (s?.value_ciphertext && s.nonce) {
              const { decryptSecret } = await import("../secrets/crypto")
              const plain = await decryptSecret(s.value_ciphertext as Buffer, s.nonce as Buffer)
              const creds = JSON.parse(plain) as { accessKeyId: string; secretAccessKey: string }
              const client = mkClient({
                ...(cfg.s3_endpoint ? { endpoint: cfg.s3_endpoint } : {}),
                region: cfg.s3_region ?? "auto",
                ...creds,
              })
              const url = new URL(row.backup.location)
              await s3Delete(client, url.hostname, url.pathname.replace(/^\//, ""))
            }
          }
        }
      } catch (err) {
        log.warn({ err, backupId }, "failed to delete S3 object (non-fatal)")
      }
    } else if (row.backup.location) {
      try {
        const { unlink } = await import("node:fs/promises")
        await unlink(row.backup.location).catch(() => {})
      } catch {
        // Non-fatal
      }
    }

    await db.delete(backups).where(eq(backups.id, backupId))
    return c.json({ ok: true })
  })

  return router
}

// ---------------------------------------------------------------------------
// Serialisers
// ---------------------------------------------------------------------------

function serializeBackup(row: typeof backups.$inferSelect) {
  return {
    id: row.id,
    databaseId: row.database_id,
    configId: row.config_id,
    destinationKind: row.destination_kind,
    location: row.location,
    sizeBytes: row.size_bytes,
    ageEncrypted: row.age_encrypted,
    status: row.status,
    error: row.error,
    startedAt: row.started_at?.toISOString(),
    finishedAt: row.finished_at?.toISOString(),
  }
}

function serializeConfig(row: typeof backup_configs.$inferSelect) {
  return {
    id: row.id,
    databaseId: row.database_id,
    destinationKind: row.destination_kind,
    s3Endpoint: row.s3_endpoint,
    s3Bucket: row.s3_bucket,
    s3Prefix: row.s3_prefix,
    s3Region: row.s3_region,
    s3CredentialsSecretId: row.s3_credentials_secret_id,
    scheduleCron: row.schedule_cron,
    retentionDays: row.retention_days,
    ageRecipientPublicKey: row.age_recipient_public_key,
    enabled: row.enabled,
    lastRunAt: row.last_run_at?.toISOString() ?? null,
    lastError: row.last_error,
    createdAt: row.created_at?.toISOString(),
  }
}
