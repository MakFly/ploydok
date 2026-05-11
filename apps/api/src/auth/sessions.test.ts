// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach } from "bun:test";
import {
  createSession,
  verifyRefreshToken,
  revokeSession,
  revokeSessionFamily,
  listSessions,
  revokeOtherSessions,
  rotateRefreshToken,
} from "./sessions";
import { sessions } from "@ploydok/db";
import { eq } from "drizzle-orm";
import { users } from "@ploydok/db";
import type { Db } from "@ploydok/db";
import { nanoid } from "nanoid";
import { makeTestDb, TEST_PG_URL } from "../test/db-helpers";

const skip = !TEST_PG_URL;
if (skip) console.log("[sessions.test] PLOYDOK_TEST_PG_URL not set — skipping");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(skip)("sessions", () => {
  let db: Db;
  let userId: string;

  beforeEach(async () => {
    const result = await makeTestDb();
    db = result.db;
    userId = `sess-${nanoid(6)}`;
    const now = new Date();
    await db.insert(users).values({
      id: userId,
      email: `user-${userId}@test.com`,
      display_name: "Test User",
      created_at: now,
      updated_at: now,
      recovery_token_hash: null,
      recovery_expires_at: null,
    }).onConflictDoNothing();
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
    expect(active.some((s) => s.id === s1.sessionId)).toBe(true);
    expect(active.every((s) => s.id !== s2.sessionId)).toBe(true);
  });

  it("revokeOtherSessions revokes all but current", async () => {
    const s1 = await createSession(db, { userId, userAgent: "A", ip: "1.0.0.1" });
    const s2 = await createSession(db, { userId, userAgent: "B", ip: "1.0.0.2" });
    await createSession(db, { userId, userAgent: "C", ip: "1.0.0.3" });

    await revokeOtherSessions(db, userId, s2.sessionId);

    const active = await listSessions(db, userId);
    expect(active.some((s) => s.id === s2.sessionId)).toBe(true);
    expect(active.every((s) => s.id !== s1.sessionId)).toBe(true);
  });

  it("rotateRefreshToken invalidates old token and issues new one", async () => {
    const { sessionId, refreshToken: oldToken } = await createSession(db, {
      userId,
      userAgent: "A",
      ip: "127.0.0.1",
    });

    const session = await verifyRefreshToken(db, sessionId, oldToken);
    expect(session).not.toBeNull();

    const newToken = await rotateRefreshToken(db, sessionId, session!.refresh_token_hash);
    expect(newToken).not.toBeNull();
    expect(newToken).not.toBe(oldToken);

    // Old token no longer valid
    const oldResult = await verifyRefreshToken(db, sessionId, oldToken);
    expect(oldResult).toBeNull();

    // New token valid
    const newResult = await verifyRefreshToken(db, sessionId, newToken!);
    expect(newResult).not.toBeNull();
  });

  it("rotateRefreshToken allows only one concurrent compare-and-swap winner", async () => {
    const { sessionId, refreshToken } = await createSession(db, {
      userId,
      userAgent: "A",
      ip: "127.0.0.1",
    });
    const session = await verifyRefreshToken(db, sessionId, refreshToken);
    expect(session).not.toBeNull();

    const [first, second] = await Promise.all([
      rotateRefreshToken(db, sessionId, session!.refresh_token_hash),
      rotateRefreshToken(db, sessionId, session!.refresh_token_hash),
    ]);

    expect([first, second].filter((token) => token !== null)).toHaveLength(1);
    expect([first, second].filter((token) => token === null)).toHaveLength(1);
  });

  it("revokeSessionFamily revokes the active refresh-token lineage", async () => {
    const { sessionId, refreshToken } = await createSession(db, {
      userId,
      userAgent: "A",
      ip: "127.0.0.1",
    });

    await revokeSessionFamily(db, sessionId);

    const result = await verifyRefreshToken(db, sessionId, refreshToken);
    expect(result).toBeNull();
    const rows = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    expect(rows[0]?.revoked_at).toBeInstanceOf(Date);
  });
});
