// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TOTP secret persistence helpers.
 *
 * Secrets are stored AES-256-GCM encrypted (same pattern as
 * apps/api/src/github/app-credentials.ts). The encrypted payload is
 * base64-encoded as JSON { enc, nonce } for storage in a TEXT column.
 */
import { eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { totp_secrets } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { encryptField, decryptField } from "../github/app-credentials"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TotpRow {
  secret: string // decrypted base32 TOTP secret
  verifiedAt: Date | null
}

// ---------------------------------------------------------------------------
// Serialise / deserialise the encrypted blob
// ---------------------------------------------------------------------------

interface EncryptedPayload {
  enc: string // base64
  nonce: string // base64
}

async function encryptSecret(plaintext: string): Promise<string> {
  const { enc, nonce } = await encryptField(plaintext)
  const payload: EncryptedPayload = {
    enc: enc.toString("base64"),
    nonce: nonce.toString("base64"),
  }
  return JSON.stringify(payload)
}

async function decryptSecret(stored: string): Promise<string> {
  const payload: EncryptedPayload = JSON.parse(stored) as EncryptedPayload
  const enc = Buffer.from(payload.enc, "base64")
  const nonce = Buffer.from(payload.nonce, "base64")
  return decryptField(enc, nonce)
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/** Upsert a TOTP secret for a user (replaces any unverified existing row). */
export async function saveTotpSecret(
  db: Db,
  userId: string,
  secret: string,
): Promise<void> {
  const secretEncrypted = await encryptSecret(secret)

  // Use insert-or-replace semantics via onConflictDoUpdate on user_id (UNIQUE).
  await db
    .insert(totp_secrets)
    .values({
      id: nanoid(),
      user_id: userId,
      secret_encrypted: secretEncrypted,
      verified_at: null,
    })
    .onConflictDoUpdate({
      target: totp_secrets.user_id,
      set: {
        id: nanoid(),
        secret_encrypted: secretEncrypted,
        verified_at: null,
        created_at: new Date(),
      },
    })
}

/** Retrieve the decrypted TOTP row for a user, or null if not enrolled. */
export async function getTotpSecret(
  db: Db,
  userId: string,
): Promise<TotpRow | null> {
  const rows = await db
    .select()
    .from(totp_secrets)
    .where(eq(totp_secrets.user_id, userId))
    .limit(1)

  const row = rows[0]
  if (!row) return null

  const secret = await decryptSecret(row.secret_encrypted)
  return {
    secret,
    verifiedAt: row.verified_at ?? null,
  }
}

/** Mark the TOTP secret as verified (sets verified_at to now). */
export async function markTotpVerified(db: Db, userId: string): Promise<void> {
  await db
    .update(totp_secrets)
    .set({ verified_at: new Date() })
    .where(eq(totp_secrets.user_id, userId))
}

/** Remove the TOTP secret for a user entirely. */
export async function deleteTotpSecret(db: Db, userId: string): Promise<void> {
  await db.delete(totp_secrets).where(eq(totp_secrets.user_id, userId))
}
