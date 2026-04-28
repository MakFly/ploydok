// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto"
import { desc, eq } from "drizzle-orm"
import { audit_log, audit_anchors } from "../schema"
import type { Db } from "../client"

export type AuditLogSignedRow = typeof audit_log.$inferSelect
export type AuditAnchorsRow = typeof audit_anchors.$inferSelect

/**
 * Canonical payload format for Ed25519 signing (v1):
 * "v1\n<id>\n<created_at_iso>\n<user_id|->\n<action>\n<target_type>\n<target_id>\n<sha256_hex(metadata_string)>\n<prev_hash|->\n<hash>"
 *
 * The signature is computed over this exact format as a Uint8Array.
 */
function buildCanonicalPayload(entry: {
  id: number
  created_at: Date
  user_id: string | null
  action: string
  target_type: string
  target_id: string
  metadata: string
  prev_hash: string | null
  hash: string | null
}): Uint8Array {
  const metadataHash = createHash("sha256").update(entry.metadata).digest("hex")
  const lines = [
    "v1",
    String(entry.id),
    entry.created_at.toISOString(),
    entry.user_id ?? "->",
    entry.action,
    entry.target_type,
    entry.target_id,
    metadataHash,
    entry.prev_hash ?? "->",
    entry.hash ?? "->",
  ]
  return new TextEncoder().encode(lines.join("\n"))
}

function computeHash(prev_hash: string | null, canonical: string): string {
  if (prev_hash) {
    return createHash("sha256")
      .update(prev_hash + canonical)
      .digest("hex")
  }
  return createHash("sha256").update(canonical).digest("hex")
}

/**
 * Insert an audit log entry with optional Ed25519 signature.
 * Performs a 2-phase atomic operation:
 * 1. INSERT with prev_hash + hash, signature=NULL → get serial id
 * 2. Build canonical payload using returned id
 * 3. Call signFn → get signature + keyId or null
 * 4. UPDATE signature + key_id WHERE id=X
 * All in one transaction.
 *
 * If signFn returns null or throws, the row is inserted with signature=NULL, key_id=NULL.
 */
export async function insertAuditLogSigned(
  db: Db,
  entry: {
    user_id: string | null
    action: string
    target_type: string
    target_id: string
    metadata?: Record<string, unknown> | string
    created_at: Date
    org_id?: string | null
  },
  signFn?: (
    canonical: Uint8Array
  ) => Promise<{ signature: string; keyId: string } | null>
): Promise<AuditLogSignedRow | null> {
  const metadata =
    typeof entry.metadata === "string"
      ? entry.metadata
      : JSON.stringify(entry.metadata || {})

  const tailResult = await db
    .select({ hash: audit_log.hash })
    .from(audit_log)
    .orderBy(desc(audit_log.id))
    .limit(1)

  const prev_hash = tailResult[0]?.hash ?? null
  const canonical = `${entry.action}|${entry.target_type}|${entry.target_id}|${metadata}`
  const hash = computeHash(prev_hash, canonical)

  return await db.transaction(async (tx) => {
    // Phase 1: INSERT with null signature, get id back
    const insertResult = await tx
      .insert(audit_log)
      .values({
        user_id: entry.user_id,
        action: entry.action,
        target_type: entry.target_type,
        target_id: entry.target_id,
        metadata,
        created_at: entry.created_at,
        prev_hash,
        hash,
        signature: null,
        key_id: null,
        org_id: entry.org_id || null,
      })
      .returning()

    const inserted = insertResult[0]
    if (!inserted) {
      return null
    }

    // Phase 2: Sign if signFn provided
    if (signFn) {
      try {
        const canonical_payload = buildCanonicalPayload(inserted)
        const result = await signFn(canonical_payload)

        if (result) {
          // Phase 3: UPDATE signature + key_id
          const updated = await tx
            .update(audit_log)
            .set({
              signature: result.signature,
              key_id: result.keyId,
            })
            .where(eq(audit_log.id, inserted.id))
            .returning()

          return updated[0] || inserted
        }
      } catch (err) {
        // Log and continue with unsigned entry
        console.warn("Failed to sign audit log entry:", err)
      }
    }

    return inserted
  })
}

/**
 * Get the audit log chain tail (most recent entries).
 * Returns entries ordered by id DESC.
 */
export async function getAuditChainTail(
  db: Db,
  limit: number = 10
): Promise<AuditLogSignedRow[]> {
  return await db
    .select()
    .from(audit_log)
    .orderBy(desc(audit_log.id))
    .limit(limit)
}

/**
 * Get the latest audit anchor.
 */
export async function getLatestAnchor(db: Db): Promise<AuditAnchorsRow | null> {
  const result = await db
    .select()
    .from(audit_anchors)
    .orderBy(desc(audit_anchors.id))
    .limit(1)

  return result[0] || null
}

/**
 * Insert an audit anchor.
 */
export async function insertAuditAnchor(
  db: Db,
  data: {
    headAuditId: number
    headHash: string
    signature: string
    keyId: string
    signedAt: Date
  }
): Promise<AuditAnchorsRow> {
  const result = await db
    .insert(audit_anchors)
    .values({
      head_audit_id: data.headAuditId,
      head_hash: data.headHash,
      signature: data.signature,
      key_id: data.keyId,
      signed_at: data.signedAt,
    })
    .returning()

  return result[0]!
}

