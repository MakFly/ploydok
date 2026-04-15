// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { requireAuth, requireSecondFactor } from "./middleware";
import { signAccessToken, buildCookieStr, ACCESS_COOKIE, ACCESS_MAX_AGE } from "./jwt";
import { createDb } from "@ploydok/db";
import { users, passkeys, backup_codes } from "@ploydok/db";
import { nanoid } from "nanoid";

// ---------------------------------------------------------------------------
// Test DB helpers
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
    CREATE TABLE IF NOT EXISTS passkeys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credential_id TEXT NOT NULL UNIQUE,
      public_key BLOB NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      transports TEXT NOT NULL DEFAULT '[]',
      device_name TEXT,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS backup_codes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL,
      consumed_at INTEGER,
      created_at INTEGER NOT NULL
    )
  `);
  return db;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("requireAuth middleware", () => {
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

  it("returns 401 without cookie", async () => {
    const app = new Hono();
    app.get("/protected", requireAuth(db), (c) => c.json({ ok: true }));

    const res = await app.request("/protected");
    expect(res.status).toBe(401);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns 200 with valid access token cookie", async () => {
    const token = await signAccessToken({ userId, email: `user-${userId}@test.com`, sessionId: "sess-1" });
    const cookieStr = buildCookieStr(ACCESS_COOKIE, token, ACCESS_MAX_AGE, false);

    const app = new Hono();
    app.get("/protected", requireAuth(db), (c) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const user = (c as any).get("user") as { id: string };
      return c.json({ ok: true, userId: user.id });
    });

    const res = await app.request("/protected", {
      headers: { cookie: `${ACCESS_COOKIE}=${encodeURIComponent(token)}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; userId: string };
    expect(body.ok).toBe(true);
    expect(body.userId).toBe(userId);
  });

  it("returns 401 with tampered token", async () => {
    const token = await signAccessToken({ userId, email: "x@x.com", sessionId: "s" });
    const parts = token.split(".");
    parts[1] = "tampered";
    const bad = parts.join(".");

    const app = new Hono();
    app.get("/protected", requireAuth(db), (c) => c.json({ ok: true }));

    const res = await app.request("/protected", {
      headers: { cookie: `${ACCESS_COOKIE}=${encodeURIComponent(bad)}` },
    });
    expect(res.status).toBe(401);
  });
});

describe("requireSecondFactor middleware", () => {
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

  async function makeApp() {
    const token = await signAccessToken({ userId, email: `user-${userId}@test.com`, sessionId: "s" });
    const app = new Hono();
    app.get(
      "/secure",
      requireAuth(db),
      requireSecondFactor(db),
      (c) => c.json({ ok: true }),
    );
    return { app, token };
  }

  it("returns 403 SECOND_FACTOR_REQUIRED when user has 0 passkeys and 0 backup codes", async () => {
    const { app, token } = await makeApp();
    const res = await app.request("/secure", {
      headers: { cookie: `${ACCESS_COOKIE}=${encodeURIComponent(token)}` },
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("SECOND_FACTOR_REQUIRED");
  });

  it("returns 200 when user has >= 2 passkeys", async () => {
    const now = new Date();
    await db.insert(passkeys).values([
      {
        id: nanoid(), user_id: userId, credential_id: "cred-1",
        public_key: Buffer.from("pk1"), counter: 0, transports: "[]",
        device_name: "Device 1", created_at: now, last_used_at: now,
      },
      {
        id: nanoid(), user_id: userId, credential_id: "cred-2",
        public_key: Buffer.from("pk2"), counter: 0, transports: "[]",
        device_name: "Device 2", created_at: now, last_used_at: now,
      },
    ]);

    const { app, token } = await makeApp();
    const res = await app.request("/secure", {
      headers: { cookie: `${ACCESS_COOKIE}=${encodeURIComponent(token)}` },
    });
    expect(res.status).toBe(200);
  });

  it("returns 200 when user has 1 passkey + 1 backup code", async () => {
    const now = new Date();
    await db.insert(passkeys).values({
      id: nanoid(), user_id: userId, credential_id: "cred-3",
      public_key: Buffer.from("pk3"), counter: 0, transports: "[]",
      device_name: null, created_at: now, last_used_at: now,
    });
    await db.insert(backup_codes).values({
      id: nanoid(), user_id: userId, code_hash: "fakehash",
      consumed_at: null, created_at: now,
    });

    const { app, token } = await makeApp();
    const res = await app.request("/secure", {
      headers: { cookie: `${ACCESS_COOKIE}=${encodeURIComponent(token)}` },
    });
    expect(res.status).toBe(200);
  });
});
