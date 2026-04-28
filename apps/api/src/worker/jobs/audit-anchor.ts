// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { desc, eq } from "drizzle-orm"
import type { Db } from "@ploydok/db"
import { audit_log } from "@ploydok/db"
import { insertAuditAnchor } from "@ploydok/db/queries"
import type { Agent } from "../../agent"
import { childLogger } from "../../logger"
import { env } from "../../env"

const log = childLogger("audit.anchor")

/**
 * Resolve the anchor file path from environment or defaults.
 * Prod default: /var/lib/ploydok/audit/anchors.log
 * Dev default: ~/.ploydok-dev/audit/anchors.log
 */
function resolveAnchorPath(): string {
  const explicit = Bun.env["PLOYDOK_AUDIT_ANCHOR_PATH"]
  if (explicit) {
    return explicit
  }

  if (env.NODE_ENV === "prod") {
    return "/var/lib/ploydok/audit/anchors.log"
  }

  const home = process.env.HOME ?? "/tmp"
  return `${home}/.ploydok-dev/audit/anchors.log`
}

/**
 * Build canonical anchor payload (v1 format):
 * "anchor-v1\n<head_audit_id>\n<head_hash>\n<signed_at_iso>"
 */
function buildCanonicalAnchorPayload(
  headAuditId: number,
  headHash: string,
  signedAt: Date
): Uint8Array {
  const lines = [
    "anchor-v1",
    String(headAuditId),
    headHash,
    signedAt.toISOString(),
  ]
  return new TextEncoder().encode(lines.join("\n"))
}

/**
 * Write anchor to file with mode 0o400.
 * Creates parent directory if needed.
 */
async function writeAnchorFile(
  filePath: string,
  jsonLine: string
): Promise<void> {
  const dir = path.dirname(filePath)
  const exists = await fs.promises
    .stat(dir)
    .then(() => true)
    .catch(() => false)

  if (!exists) {
    await fs.promises.mkdir(dir, { recursive: true })
  }

  const fileExists = await fs.promises
    .stat(filePath)
    .then(() => true)
    .catch(() => false)

  await fs.promises.appendFile(filePath, jsonLine + "\n")

  if (!fileExists) {
    await fs.promises.chmod(filePath, 0o400)
  }
}

/**
 * Run audit anchor job — creates an anchor from the latest audit log entry.
 * Called hourly by the worker cron.
 *
 * Steps:
 * 1. Get latest audit log entry (id, hash)
 * 2. If none, return early
 * 3. Build canonical payload
 * 4. Sign via agent.signAuditEntry
 * 5. Append JSON line to anchor file
 * 6. Insert anchor row in audit_anchors table
 */
export async function runAuditAnchor(deps: {
  db: Db
  agent: Agent
  anchorPath: string
}): Promise<{ anchored: number | null }> {
  const { db, agent, anchorPath } = deps

  try {
    // Get the latest audit log entry
    const tailResult = await db
      .select({ id: audit_log.id, hash: audit_log.hash })
      .from(audit_log)
      .orderBy(desc(audit_log.id))
      .limit(1)

    if (!tailResult[0]) {
      log.debug("no audit log entries to anchor")
      return { anchored: null }
    }

    const headAuditId = tailResult[0].id
    const headHash = tailResult[0].hash

    if (!headHash) {
      log.warn("latest audit log entry has no hash, skipping anchor")
      return { anchored: null }
    }

    const signedAt = new Date()
    const canonical = buildCanonicalAnchorPayload(
      headAuditId,
      headHash,
      signedAt
    )

    // Sign the canonical payload
    const { signature, keyId } = await agent.signAuditEntry(canonical, "")
    const sig = Buffer.from(signature).toString("base64url")

    // Write anchor line to file
    const anchorLine = JSON.stringify({
      id: headAuditId,
      hash: headHash,
      sig,
      kid: keyId,
      at: signedAt.toISOString(),
    })
    await writeAnchorFile(anchorPath, anchorLine)

    // Insert anchor row in DB
    const anchor = await insertAuditAnchor(db, {
      headAuditId,
      headHash,
      signature: sig,
      keyId,
      signedAt,
    })

    log.info(
      { headAuditId, keyId, anchorId: anchor.id },
      "audit anchor created"
    )

    return { anchored: headAuditId }
  } catch (err) {
    log.error({ err }, "audit anchor job failed")
    throw err
  }
}

let _timer: ReturnType<typeof setInterval> | null = null

/**
 * Start the audit anchor cron job (hourly).
 */
export function startAuditAnchorCron(db: Db, agent: Agent): void {
  stopAuditAnchorCron()

  const anchorPath = resolveAnchorPath()

  // Run once immediately on boot
  void runAuditAnchor({ db, agent, anchorPath }).catch((err) => {
    log.error({ err }, "initial anchor failed")
  })

  // Then every hour
  _timer = setInterval(
    () => {
      void runAuditAnchor({ db, agent, anchorPath }).catch((err) => {
        log.error({ err }, "anchor tick failed")
      })
    },
    60 * 60 * 1000
  )

  log.info("audit anchor cron scheduled (hourly)")
}

/**
 * Stop the audit anchor cron.
 */
export function stopAuditAnchorCron(): void {
  if (_timer !== null) {
    clearInterval(_timer)
    _timer = null
  }
}
