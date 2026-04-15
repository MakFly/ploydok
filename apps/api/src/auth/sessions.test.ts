// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach } from "bun:test";
import {
  createSession,
  verifyRefreshToken,
  revokeSession,
  listSessions,
  revokeOtherSessions,
  rotateRefreshToken,
} from "./sessions";
import { createDb } from "@ploydok/db";
import { users, sessions } from "@ploydok/db";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// In-memory test DB
// ---------------------------------------------------------------------------

function makeTestDb() {
  const db = createDb(":memory:");
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      recovery_token_hash TEXT,
      recovery_expires_at INTEGER
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      refresh_token_hash TEXT NOT NULL,
      user_agent TEXT NOT NULL,
      ip TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      revoked_at INTEGER,
      expires_at INTEGER NOT NULL
    )
  `);
  return db;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sessions", () => {
  let db: ReturnType<typeof makeTestDb>;
  let userId: string;

  beforeEach(async () => {
    db = makeTestDb();
    userId = nanoid();
    const now = new Date();
    await db.insert(users).values({
      id: userId,
      email: `user-${userId}@test.com`,
      display_name: "Test User",
      created_at: now,
      updated_at: now,
      recovery_token_hash: null,
      recovery_expires_at: null,
    });
  });

  it("createSession returns sessionId and refreshToken", async () => {
    const result = await createSession(db, { userId, userAgent: "TestAgent/1.0", ip: "127.0.0.1" });
    expect(typeof result.sessionId).toBe("string");
    expect(typeof result.refreshToken).toBe("string");
    expect(result.refreshToken.length).toBeGreaterThan(32);
  });

  it("verifyRefreshToken returns session on valid token", async () => {
    const { sessionId, refreshToken } = await createSession(db, {
      userId,
      userAgent: "TestAgent",
      ip: "127.0.0.1",
    });
    const session = await verifyRefreshToken(db, sessionId, refreshToken);
    expect(session).not.toBeNull();
    expect(session!.id).toBe(sessionId);
  });

  it("verifyRefreshToken returns null on wrong token", async () => {
    const { sessionId } = await createSession(db, { userId, userAgent: "TestAgent", ip: "127.0.0.1" });
    const result = await verifyRefreshToken(db, sessionId, "wrong-token");
    expect(result).toBeNull();
  });

  it("revokeSession marks session as revoked", async () => {
    const { sessionId, refreshToken } = await createSession(db, {
      userId,
      userAgent: "TestAgent",
      ip: "127.0.0.1",
    });
    await revokeSession(db, sessionId);
    const result = await verifyRefreshToken(db, sessionId, refreshToken);
    expect(result).toBeNull();
  });

  it("listSessions returns active sessions only", async () => {
    const s1 = await createSession(db, { userId, userAgent: "A", ip: "1.2.3.4" });
    const s2 = await createSession(db, { userId, userAgent: "B", ip: "1.2.3.5" });
    await revokeSession(db, s2.sessionId);

    const active = await listSessions(db, userId);
    expect(active.length).toBe(1);
    expect(active[0]!.id).toBe(s1.sessionId);
  });

  it("revokeOtherSessions revokes all but current", async () => {
    const s1 = await createSession(db, { userId, userAgent: "A", ip: "1.0.0.1" });
    const s2 = await createSession(db, { userId, userAgent: "B", ip: "1.0.0.2" });
    const s3 = await createSession(db, { userId, userAgent: "C", ip: "1.0.0.3" });

    await revokeOtherSessions(db, userId, s2.sessionId);

    const active = await listSessions(db, userId);
    expect(active.length).toBe(1);
    expect(active[0]!.id).toBe(s2.sessionId);
  });

  it("rotateRefreshToken invalidates old token and issues new one", async () => {
    const { sessionId, refreshToken: oldToken } = await createSession(db, {
      userId,
      userAgent: "A",
      ip: "127.0.0.1",
    });

    const newToken = await rotateRefreshToken(db, sessionId);
    expect(newToken).not.toBe(oldToken);

    // Old token no longer valid
    const oldResult = await verifyRefreshToken(db, sessionId, oldToken);
    expect(oldResult).toBeNull();

    // New token valid
    const newResult = await verifyRefreshToken(db, sessionId, newToken);
    expect(newResult).not.toBeNull();
  });
});
