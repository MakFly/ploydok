// SPDX-License-Identifier: AGPL-3.0-only
/**
 * DB password rotation orchestration — Wave 5.
 *
 * Flow:
 *  1. Lock the database row (rotation_in_progress = true).
 *  2. Generate a new password.
 *  3. Create new DB user with new password (double-write: old user stays active).
 *  4. Store old password in password_history (TTL 24h).
 *  5. Update databases.master_password_enc with new password.
 *  6. Update all linked app secrets (<PREFIX>_PASSWORD, <PREFIX>_URL, <PREFIX>_HOST…).
 *  7. Enqueue rolling redeploy for all linked apps.
 *  8. Poll until all apps are running (5 min timeout, 15s poll).
 *     → on timeout/failure: rollback (restore old password, re-deploy apps, DROP new user).
 *  9. DROP old user from DB container.
 * 10. Update databases.password_rotated_at + unlock.
 * 11. Dispatch db.rotated notification.
 */
import { randomBytes } from "node:crypto"
import { nanoid } from "nanoid"
import { and, eq, inArray, lt } from "drizzle-orm"
import {
  databases,
  app_db_links,
  secrets,
  apps,
  password_history,
} from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { childLogger } from "../logger"
import { encryptSecret, decryptSecret } from "../secrets/crypto"
import { getSharedAgent } from "../debug/singletons"
import { deployQueue } from "../worker/queues"
import { dispatch } from "../notify/index"
import { createRedis } from "@ploydok/db"
import { env } from "../env"
import type { Agent } from "../agent/index"
import { normalizePostgresConnectionString } from "./connection-strings"

const log = childLogger("databases.rotation")

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class RotationFailedError extends Error {
  constructor(
    message: string,
    public readonly databaseId: string
  ) {
    super(message)
    this.name = "RotationFailedError"
  }
}

export class RotationInProgressError extends Error {
  constructor(databaseId: string) {
    super(`Rotation already in progress for database ${databaseId}`)
    this.name = "RotationInProgressError"
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RotationResult {
  databaseId: string
  rotatedAt: Date
  appsRedeployed: string[]
}

type DbKind = "postgres" | "redis" | "mongo"

// ---------------------------------------------------------------------------
// Helpers — generate password
// ---------------------------------------------------------------------------

function generatePassword(): string {
  return randomBytes(24).toString("base64url")
}

// ---------------------------------------------------------------------------
// Helpers — exec command in DB container via ContainerExec
// ---------------------------------------------------------------------------

async function execInDbContainer(
  agent: Agent,
  containerId: string,
  cmd: string[],
  timeoutMs = 15_000
): Promise<{ stdout: string; exitCode: number }> {
  const exec = agent.containerExec()
  exec.send({
    start: {
      containerId,
      cmd,
      tty: false,
      cols: 220,
      rows: 50,
      user: "",
    },
  })

  const chunks: string[] = []
  let exitCode = 0
  const timeoutHandle = setTimeout(() => exec.close(), timeoutMs)
  try {
    for await (const frame of exec.events) {
      if (frame.stdout?.length)
        chunks.push(Buffer.from(frame.stdout).toString("utf-8"))
      if (frame.exit !== undefined) {
        exitCode = frame.exit.code
        break
      }
    }
  } finally {
    clearTimeout(timeoutHandle)
    exec.close()
  }
  return { stdout: chunks.join(""), exitCode }
}

// ---------------------------------------------------------------------------
// Helpers — DB-kind-specific SQL to create new user with new password
// ---------------------------------------------------------------------------

async function addNewPassword(
  agent: Agent,
  containerId: string,
  kind: DbKind,
  opts: { oldUser: string; newUser: string; newPwd: string; database: string }
): Promise<void> {
  const { oldUser, newUser, newPwd, database } = opts
  let cmd: string[]
  switch (kind) {
    case "postgres": {
      const sql = [
        `CREATE USER "${newUser}" WITH PASSWORD '${newPwd}';`,
        `GRANT ALL PRIVILEGES ON DATABASE "${database}" TO "${newUser}";`,
        `GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "${newUser}";`,
        `GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "${newUser}";`,
        `GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO "${newUser}";`,
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "${newUser}";`,
      ].join(" ")
      cmd = ["psql", "-U", oldUser, "-d", database, "-c", sql]
      break
    }
    case "redis": {
      // Redis ACL: create new user with new password alongside old user
      const aclCmd = `ACL SETUSER ${newUser} on >${newPwd} ~* &* +@all`
      cmd = ["redis-cli", aclCmd]
      break
    }
    case "mongo": {
      const js = `db.getSiblingDB("${database}").createUser({ user: "${newUser}", pwd: "${newPwd}", roles: [{ role: "readWrite", db: "${database}" }, { role: "dbOwner", db: "${database}" }] })`
      cmd = ["mongosh", "--eval", js]
      break
    }
  }

  const result = await execInDbContainer(agent, containerId, cmd)
  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to add new DB user ${newUser}: exit ${result.exitCode}\n${result.stdout}`
    )
  }
}

async function dropOldUser(
  agent: Agent,
  containerId: string,
  kind: DbKind,
  opts: { oldUser: string; newUser: string; database: string }
): Promise<void> {
  const { oldUser, newUser, database } = opts
  let cmd: string[]
  switch (kind) {
    case "postgres": {
      const sql = `REASSIGN OWNED BY "${oldUser}" TO "${newUser}"; DROP OWNED BY "${oldUser}"; DROP USER IF EXISTS "${oldUser}";`
      cmd = ["psql", "-U", newUser, "-d", database, "-c", sql]
      break
    }
    case "redis": {
      cmd = ["redis-cli", `ACL DELUSER ${oldUser}`]
      break
    }
    case "mongo": {
      const js = `db.getSiblingDB("${database}").dropUser("${oldUser}")`
      cmd = ["mongosh", "--eval", js]
      break
    }
  }

  const result = await execInDbContainer(agent, containerId, cmd)
  if (result.exitCode !== 0) {
    // Non-fatal — log warning and continue
    log.warn(
      { exitCode: result.exitCode, oldUser, kind },
      "dropOldUser failed (non-fatal)"
    )
  }
}

// ---------------------------------------------------------------------------
// Helpers — update linked app secrets with new password
// ---------------------------------------------------------------------------

function rebuildConnectionString(
  kind: DbKind,
  oldConnStr: string,
  newPwd: string,
  newUser: string
): string {
  const url = new URL(oldConnStr)
  url.password = encodeURIComponent(newPwd)
  url.username = encodeURIComponent(newUser)
  return url.toString()
}

function buildSecretVars(
  kind: DbKind,
  newConnString: string,
  prefix: string,
  newUser: string,
  newPwd: string
): Record<string, string> {
  const normalizedConnString =
    kind === "postgres"
      ? normalizePostgresConnectionString(newConnString)
      : newConnString
  const url = new URL(normalizedConnString)
  const vars: Record<string, string> = {}
  vars[`${prefix}_URL`] = normalizedConnString
  vars[`${prefix}_PASSWORD`] = newPwd
  if (kind !== "redis") {
    vars[`${prefix}_USER`] = newUser
  }
  vars[`${prefix}_HOST`] = url.hostname
  vars[`${prefix}_PORT`] = url.port
  return vars
}

// ---------------------------------------------------------------------------
// Main rotation function
// ---------------------------------------------------------------------------

export async function rotatePassword(
  db: Db,
  databaseId: string,
  opts?: { reason?: string }
): Promise<RotationResult> {
  const rotLog = log.child({ databaseId, reason: opts?.reason ?? "manual" })

  // 1. Load DB row and check preconditions
  const dbRows = await db
    .select()
    .from(databases)
    .where(eq(databases.id, databaseId))
    .limit(1)
  const dbRow = dbRows[0]
  if (!dbRow) throw new Error(`Database not found: ${databaseId}`)
  if (dbRow.status !== "running") {
    throw new Error(
      `Cannot rotate password for database with status ${dbRow.status}`
    )
  }
  if (dbRow.rotation_in_progress) {
    throw new RotationInProgressError(databaseId)
  }
  if (!dbRow.container_id) {
    throw new Error("Database container_id is null — cannot rotate")
  }

  const kind = dbRow.kind as DbKind
  const containerId = dbRow.container_id

  // 2. Decrypt old password + derive old user/database names from connection string
  if (!dbRow.master_password_enc || !dbRow.master_password_nonce) {
    throw new Error("master_password_enc is null — cannot rotate")
  }
  const oldPwd = await decryptSecret(
    dbRow.master_password_enc as Buffer,
    dbRow.master_password_nonce as Buffer
  )

  // Derive old connection string
  let oldConnStr = ""
  if (dbRow.connection_string_enc && dbRow.connection_string_nonce) {
    oldConnStr = await decryptSecret(
      dbRow.connection_string_enc as Buffer,
      dbRow.connection_string_nonce as Buffer
    )
  }

  // Parse old user and database from connection string
  const connUrl = oldConnStr ? new URL(oldConnStr) : null
  const oldUser = connUrl ? decodeURIComponent(connUrl.username) : "ploydok"
  const database = connUrl
    ? (connUrl.pathname.replace(/^\//, "").split("?")[0] ?? "app")
    : "app"

  // New credentials
  const newPwd = generatePassword()
  const newUser = kind === "redis" ? "default_new" : `${oldUser}_new`

  // 3. Lock rotation
  await db
    .update(databases)
    .set({ rotation_in_progress: true })
    .where(eq(databases.id, databaseId))

  rotLog.info({ kind, containerId, oldUser, newUser }, "rotation started")

  try {
    // 4. Create new user with new password in DB container
    const agent = getSharedAgent()
    await addNewPassword(agent, containerId, kind, {
      oldUser,
      newUser,
      newPwd,
      database,
    })
    rotLog.info({ newUser }, "new DB user created with new password")

    // 5. Store old password in password_history (for audit + rollback reference)
    const { enc: pwHistEnc, nonce: pwHistNonce } = await encryptSecret(oldPwd)
    await db.insert(password_history).values({
      id: nanoid(),
      database_id: databaseId,
      password_enc: pwHistEnc,
      nonce: pwHistNonce,
    })

    // 6. Update databases.master_password_enc with new password
    const newConnStr = oldConnStr
      ? rebuildConnectionString(kind, oldConnStr, newPwd, newUser)
      : oldConnStr
    const { enc: newPwEnc, nonce: newPwNonce } = await encryptSecret(newPwd)
    const { enc: newConnEnc, nonce: newConnNonce } = newConnStr
      ? await encryptSecret(newConnStr)
      : {
          enc: dbRow.connection_string_enc,
          nonce: dbRow.connection_string_nonce,
        }

    await db
      .update(databases)
      .set({
        master_password_enc: newPwEnc,
        master_password_nonce: newPwNonce,
        ...(newConnStr && {
          connection_string_enc: newConnEnc,
          connection_string_nonce: newConnNonce,
        }),
      })
      .where(eq(databases.id, databaseId))

    // 7. Update linked app secrets for all linked apps
    const links = await db
      .select()
      .from(app_db_links)
      .where(eq(app_db_links.database_id, databaseId))

    const linkedAppIds = links.map((l) => l.app_id)

    // Load project_id for each linked app (needed for secrets.project_id)
    let appProjectMap: Map<string, string> = new Map()
    if (linkedAppIds.length > 0) {
      const appRows = await db
        .select({ id: apps.id, project_id: apps.project_id })
        .from(apps)
        .where(inArray(apps.id, linkedAppIds))
      for (const r of appRows) appProjectMap.set(r.id, r.project_id)
    }

    for (const link of links) {
      const prefix = link.env_prefix
      const vars = buildSecretVars(
        kind,
        newConnStr || oldConnStr,
        prefix,
        newUser,
        newPwd
      )
      const appProjectId = appProjectMap.get(link.app_id) ?? null

      // Delete old linked secrets for this (app, db) pair
      await db
        .delete(secrets)
        .where(
          and(
            eq(secrets.app_id, link.app_id),
            eq(secrets.linked_database_id, databaseId)
          )
        )

      // Insert fresh secrets
      const now = new Date()
      for (const [key, value] of Object.entries(vars)) {
        const { enc, nonce } = await encryptSecret(value)
        await db.insert(secrets).values({
          id: nanoid(),
          app_id: link.app_id,
          project_id: appProjectId,
          scope: "shared",
          key,
          value_ciphertext: enc,
          nonce,
          linked_database_id: databaseId,
          created_at: now,
        })
      }
    }

    rotLog.info({ linkedAppIds }, "linked app secrets updated")

    // 8. Enqueue rolling redeploy for all linked apps
    for (const appId of linkedAppIds) {
      await deployQueue.add(
        "deploy.requested",
        { appId, kind: "rotation_redeploy" },
        { jobId: `rotation-redeploy-${databaseId}-${appId}-${Date.now()}` }
      )
    }

    // 9. Poll until all apps are running (5 min, 15s poll)
    if (linkedAppIds.length > 0) {
      const pollStart = Date.now()
      const pollTimeoutMs = 5 * 60 * 1000
      const pollIntervalMs = 15_000
      let allHealthy = false

      while (Date.now() - pollStart < pollTimeoutMs) {
        await new Promise((r) => setTimeout(r, pollIntervalMs))
        const appStatusRows = await db
          .select({ id: apps.id, status: apps.status })
          .from(apps)
          .where(inArray(apps.id, linkedAppIds))
        const allRunning = appStatusRows.every((a) => a.status === "running")
        const anyFailed = appStatusRows.some((a) => a.status === "failed")
        if (anyFailed) break
        if (allRunning) {
          allHealthy = true
          break
        }
      }

      if (!allHealthy) {
        rotLog.warn("not all apps became healthy after rotation — rolling back")
        // Rollback: restore old password in DB + re-deploy with old creds
        await rollbackRotation(db, agent, {
          databaseId,
          containerId,
          kind,
          oldPwd,
          oldUser,
          newUser,
          database,
          oldConnStr,
          linkedAppIds,
        })
        throw new RotationFailedError(
          "Rolling redeploy after rotation failed — rolled back to old password",
          databaseId
        )
      }
    }

    // 10. DROP old user (double-write window ends)
    await dropOldUser(agent, containerId, kind, { oldUser, newUser, database })
    rotLog.info({ oldUser }, "old DB user dropped")

    // 11. Update rotated_at + unlock
    const rotatedAt = new Date()
    await db
      .update(databases)
      .set({
        password_rotated_at: rotatedAt,
        rotation_in_progress: false,
      })
      .where(eq(databases.id, databaseId))

    // 12. Dispatch notification (best-effort)
    try {
      const redis = createRedis(env.REDIS_URL)
      // Find project owner_id for scope
      const projRows = await db
        .select({ owner_id: apps.project_id })
        .from(databases)
        .where(eq(databases.id, databaseId))
        .limit(1)
      // Dispatch db.rotated — uses appId as a proxy since the shared type expects appId
      await dispatch(
        db,
        redis,
        "db.rotated",
        {
          appId: databaseId,
          appName: dbRow.name,
        },
        { userId: dbRow.project_id } // best-effort scope
      )
    } catch (notifyErr) {
      rotLog.warn({ notifyErr }, "db.rotated dispatch failed (non-fatal)")
    }

    rotLog.info({ rotatedAt }, "rotation completed successfully")
    return { databaseId, rotatedAt, appsRedeployed: linkedAppIds }
  } catch (err) {
    // Release lock on any unexpected error (rollback already releases it in the unhealthy path)
    try {
      await db
        .update(databases)
        .set({ rotation_in_progress: false })
        .where(eq(databases.id, databaseId))
    } catch {
      // Ignore secondary error
    }
    throw err
  }
}

// ---------------------------------------------------------------------------
// Rollback helper
// ---------------------------------------------------------------------------

interface RollbackOpts {
  databaseId: string
  containerId: string
  kind: DbKind
  oldPwd: string
  oldUser: string
  newUser: string
  database: string
  oldConnStr: string
  linkedAppIds: string[]
}

async function rollbackRotation(
  db: Db,
  agent: Agent,
  opts: RollbackOpts
): Promise<void> {
  const {
    databaseId,
    containerId,
    kind,
    oldPwd,
    oldUser,
    newUser,
    database,
    oldConnStr,
    linkedAppIds,
  } = opts
  const rollLog = log.child({ databaseId, phase: "rollback" })

  try {
    // Restore old password in databases table
    const { enc: oldPwEnc, nonce: oldPwNonce } = await encryptSecret(oldPwd)
    const { enc: oldConnEnc, nonce: oldConnNonce } = oldConnStr
      ? await encryptSecret(oldConnStr)
      : { enc: null, nonce: null }

    await db
      .update(databases)
      .set({
        master_password_enc: oldPwEnc,
        master_password_nonce: oldPwNonce,
        ...(oldConnStr && {
          connection_string_enc: oldConnEnc,
          connection_string_nonce: oldConnNonce,
        }),
      })
      .where(eq(databases.id, databaseId))

    // Restore linked secrets from old connection string
    const links = await db
      .select()
      .from(app_db_links)
      .where(eq(app_db_links.database_id, databaseId))

    // Load app project_id map for rollback
    const rollbackAppIds = links.map((l) => l.app_id)
    const rollbackAppMap: Map<string, string> = new Map()
    if (rollbackAppIds.length > 0) {
      const appRows = await db
        .select({ id: apps.id, project_id: apps.project_id })
        .from(apps)
        .where(inArray(apps.id, rollbackAppIds))
      for (const r of appRows) rollbackAppMap.set(r.id, r.project_id)
    }

    for (const link of links) {
      await db
        .delete(secrets)
        .where(
          and(
            eq(secrets.app_id, link.app_id),
            eq(secrets.linked_database_id, databaseId)
          )
        )
      const vars = buildSecretVars(
        kind,
        oldConnStr,
        link.env_prefix,
        oldUser,
        oldPwd
      )
      const appProjectId = rollbackAppMap.get(link.app_id) ?? null
      const now = new Date()
      for (const [key, value] of Object.entries(vars)) {
        const { enc, nonce } = await encryptSecret(value)
        await db.insert(secrets).values({
          id: nanoid(),
          app_id: link.app_id,
          project_id: appProjectId,
          scope: "shared",
          key,
          value_ciphertext: enc,
          nonce,
          linked_database_id: databaseId,
          created_at: now,
        })
      }
    }

    // Re-deploy all linked apps with old credentials
    for (const appId of linkedAppIds) {
      await deployQueue
        .add(
          "deploy.requested",
          { appId, kind: "rotation_rollback" },
          { jobId: `rotation-rollback-${databaseId}-${appId}-${Date.now()}` }
        )
        .catch((err) =>
          rollLog.warn({ err, appId }, "rollback redeploy enqueue failed")
        )
    }

    // Try to drop the new user that was created
    await dropOldUser(agent, containerId, kind, {
      oldUser: newUser,
      newUser: oldUser,
      database,
    })
    rollLog.info({ newUser }, "new user dropped during rollback")
  } catch (err) {
    rollLog.error(
      { err },
      "rollback failed — manual intervention may be required"
    )
  } finally {
    await db
      .update(databases)
      .set({ rotation_in_progress: false })
      .where(eq(databases.id, databaseId))
  }
}

// ---------------------------------------------------------------------------
// Purge old password history (> 24h)
// ---------------------------------------------------------------------------

export async function purgePasswordHistory(db: Db): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
  await db
    .delete(password_history)
    .where(lt(password_history.created_at, cutoff))
  log.debug({ cutoff }, "password history purged")
}
