// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from "node:crypto"
import bcrypt from "bcryptjs"
import { nanoid } from "nanoid"
import { eq, and, isNull } from "drizzle-orm"
import type { Db } from "@ploydok/db"
import { backup_codes } from "@ploydok/db"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BCRYPT_ROUNDS = 10
const CODE_COUNT = 10

// ---------------------------------------------------------------------------
// Generate raw codes (XXXX-XXXX-XXXX format, base32-ish chars)
// ---------------------------------------------------------------------------

const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

function randomSegment(len = 4): string {
  let s = ""
  const bytes = randomBytes(len)
  for (let i = 0; i < len; i++) {
    s += BASE32_CHARS[bytes[i]! & 31]!
  }
  return s
}

function generateCode(): string {
  return `${randomSegment()}-${randomSegment()}-${randomSegment()}`
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate 10 backup codes for a user.
 * Returns the raw codes (to be shown once) and persists hashed versions to DB.
 */
export async function generate(db: Db, userId: string): Promise<string[]> {
  const codes: string[] = []
  const rows: (typeof backup_codes.$inferInsert)[] = []

  for (let i = 0; i < CODE_COUNT; i++) {
    const code = generateCode()
    const hash = await bcrypt.hash(code, BCRYPT_ROUNDS)
    codes.push(code)
    rows.push({
      id: nanoid(),
      user_id: userId,
      code_hash: hash,
      consumed_at: null,
      created_at: new Date(),
    })
  }

  await db.insert(backup_codes).values(rows)
  return codes
}

/**
 * Consume a backup code for a user (one-shot use).
 * Returns true if the code was valid and not yet consumed.
 */
export async function consume(
  db: Db,
  userId: string,
  rawCode: string
): Promise<boolean> {
  // Fetch all non-consumed codes for this user
  const rows = await db
    .select()
    .from(backup_codes)
    .where(
      and(eq(backup_codes.user_id, userId), isNull(backup_codes.consumed_at))
    )

  for (const row of rows) {
    const match = await bcrypt.compare(rawCode, row.code_hash)
    if (match) {
      const updated = await db
        .update(backup_codes)
        .set({ consumed_at: new Date() })
        .where(and(eq(backup_codes.id, row.id), isNull(backup_codes.consumed_at)))
        .returning({ id: backup_codes.id })
      return updated.length > 0
    }
  }

  return false
}

/**
 * Regenerate backup codes: marks all non-consumed codes as consumed (invalidated),
 * then generates a fresh batch.
 */
export async function regenerate(db: Db, userId: string): Promise<string[]> {
  // Invalidate all existing non-consumed codes by setting consumed_at
  await db
    .update(backup_codes)
    .set({ consumed_at: new Date() })
    .where(
      and(eq(backup_codes.user_id, userId), isNull(backup_codes.consumed_at))
    )

  return generate(db, userId)
}

/**
 * Count active (non-consumed) backup codes for a user.
 */
export async function countActive(db: Db, userId: string): Promise<number> {
  const rows = await db
    .select({ id: backup_codes.id })
    .from(backup_codes)
    .where(
      and(eq(backup_codes.user_id, userId), isNull(backup_codes.consumed_at))
    )
  return rows.length
}
