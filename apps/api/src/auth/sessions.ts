// SPDX-License-Identifier: AGPL-3.0-only
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { eq, and, isNull, ne } from "drizzle-orm";
import type { Db } from "@ploydok/db";
import { sessions } from "@ploydok/db";
import { randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BCRYPT_ROUNDS = 10;
const REFRESH_BYTES = 64;
const SESSION_TTL_DAYS = 7;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateSessionResult {
  sessionId: string;
  refreshToken: string; // raw — send to client
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a cryptographically random refresh token (base64url, 64 bytes).
 */
export function generateRefreshToken(): string {
  return randomBytes(REFRESH_BYTES).toString("base64url");
}

/**
 * Create a new session and return the raw refresh token.
 */
export async function createSession(
  db: Db,
  opts: {
    userId: string;
    userAgent: string;
    ip: string;
  },
): Promise<CreateSessionResult> {
  const refreshToken = generateRefreshToken();
  const hash = await bcrypt.hash(refreshToken, BCRYPT_ROUNDS);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const id = nanoid();

  await db.insert(sessions).values({
    id,
    user_id: opts.userId,
    refresh_token_hash: hash,
    user_agent: opts.userAgent,
    ip: opts.ip,
    created_at: now,
    last_seen_at: now,
    revoked_at: null,
    expires_at: expiresAt,
  });

  return { sessionId: id, refreshToken };
}

/**
 * Verify a refresh token against its session hash.
 * Returns the session row if valid, null otherwise.
 */
export async function verifyRefreshToken(
  db: Db,
  sessionId: string,
  rawToken: string,
): Promise<typeof sessions.$inferSelect | null> {
  const rows = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revoked_at)))
    .limit(1);

  const session = rows[0];
  if (!session) return null;

  // Check expiry
  if (session.expires_at < new Date()) return null;

  const match = await bcrypt.compare(rawToken, session.refresh_token_hash);
  return match ? session : null;
}

/**
 * Rotate refresh token with compare-and-swap semantics.
 * Returns the new raw refresh token, or null if another refresh already rotated it.
 */
export async function rotateRefreshToken(
  db: Db,
  sessionId: string,
  currentRefreshTokenHash: string,
): Promise<string | null> {
  const newToken = generateRefreshToken();
  const hash = await bcrypt.hash(newToken, BCRYPT_ROUNDS);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  const rows = await db
    .update(sessions)
    .set({
      refresh_token_hash: hash,
      last_seen_at: now,
      rotated_at: now,
      expires_at: expiresAt,
    })
    .where(
      and(
        eq(sessions.id, sessionId),
        eq(sessions.refresh_token_hash, currentRefreshTokenHash),
        isNull(sessions.revoked_at),
      ),
    )
    .returning({ id: sessions.id });

  if (!rows[0]) return null;

  return newToken;
}

/**
 * Revoke a session by setting revoked_at.
 */
export async function revokeSession(db: Db, sessionId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revoked_at: new Date() })
    .where(eq(sessions.id, sessionId));
}

/**
 * Revoke the refresh-token family represented by a session id.
 *
 * The current schema keeps one stable session row across refresh rotations, so
 * the family is the row's full token lineage.
 */
export async function revokeSessionFamily(db: Db, sessionId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revoked_at: new Date() })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revoked_at)));
}

/**
 * List active sessions for a user, annotated with whether each is the current session.
 */
export async function listSessions(
  db: Db,
  userId: string,
): Promise<(typeof sessions.$inferSelect)[]> {
  return db
    .select()
    .from(sessions)
    .where(and(eq(sessions.user_id, userId), isNull(sessions.revoked_at)));
}

/**
 * Revoke all sessions for a user except the current one.
 */
export async function revokeOtherSessions(
  db: Db,
  userId: string,
  currentSessionId: string,
): Promise<void> {
  await db
    .update(sessions)
    .set({ revoked_at: new Date() })
    .where(
      and(
        eq(sessions.user_id, userId),
        isNull(sessions.revoked_at),
        ne(sessions.id, currentSessionId),
      ),
    );
}
