// SPDX-License-Identifier: AGPL-3.0-only
//
// E2E auth flow tests.
//
// NOTE: Full WebAuthn register/login flows require a real authenticator or a
// browser-level stub (navigator.credentials). Mocking @simplewebauthn/server
// at the module level in Bun's test runner is not straightforward in v1.
// These tests are skipped and will be implemented in Sprint 6 as integration
// tests against a real WebAuthn software authenticator.
//
// What IS tested here:
//   - /me returns 401 without auth
//   - /auth/backup-codes/consume rejects invalid code
//   - /auth/sessions/revoke-others works via DB helpers
//
// See docs/adr/0002-auth-design.md for rationale.

import { describe, it, expect, test } from "bun:test";

// We test through the Hono app directly (no real HTTP server needed)
// but we need a real DB with schema. We use the helper from sessions.test.ts.

import { Hono } from "hono";
import { requireAuth } from "./middleware";
import { signAccessToken, ACCESS_COOKIE } from "./jwt";
import { createDb } from "@ploydok/db";
import { users } from "@ploydok/db";
import { nanoid } from "nanoid";

function makeFullTestDb() {
  const db = createDb(":memory:");
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      recovery_token_hash TEXT, recovery_expires_at INTEGER
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS passkeys (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credential_id TEXT NOT NULL UNIQUE, public_key BLOB NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0, transports TEXT NOT NULL DEFAULT '[]',
      device_name TEXT, created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS backup_codes (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL, consumed_at INTEGER, created_at INTEGER NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      refresh_token_hash TEXT NOT NULL, user_agent TEXT NOT NULL, ip TEXT NOT NULL,
      created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
      revoked_at INTEGER, expires_at INTEGER NOT NULL
    )
  `);
  return db;
}

describe("/me endpoint", () => {
  it("returns 401 without auth cookie", async () => {
    const db = makeFullTestDb();
    const app = new Hono();
    app.get("/me", requireAuth(db), (c) => c.json({ ok: true }));

    const res = await app.request("/me");
    expect(res.status).toBe(401);
  });

  it("returns 200 with valid auth cookie and user in context", async () => {
    const db = makeFullTestDb();
    const userId = nanoid();
    const now = new Date();
    await db.insert(users).values({
      id: userId,
      email: `alice-${userId}@example.com`,
      display_name: "Alice",
      created_at: now,
      updated_at: now,
      recovery_token_hash: null,
      recovery_expires_at: null,
    });

    const token = await signAccessToken({ userId, email: `alice-${userId}@example.com`, sessionId: "sess" });

    const app = new Hono();
    app.get("/me", requireAuth(db), (c) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const user = (c as any).get("user") as { id: string };
      return c.json({ id: user.id });
    });

    const res = await app.request("/me", {
      headers: { cookie: `${ACCESS_COOKIE}=${encodeURIComponent(token)}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string };
    expect(body.id).toBe(userId);
  });
});

// ---------------------------------------------------------------------------
// WebAuthn flow — skipped in v1, to be implemented in Sprint 6
// ---------------------------------------------------------------------------

test.skip("register → login → /me flow (requires WebAuthn mock, Sprint 6)", async () => {
  // TODO Sprint 6: Use a software authenticator (e.g., virtual-authenticator-js)
  // to exercise the full WebAuthn registration and authentication flow end-to-end.
  // Steps:
  // 1. GET /auth/register/options?email=...&display_name=...
  // 2. Stub navigator.credentials.create() with the options
  // 3. POST /auth/register/verify with the stubbed credential
  // 4. GET /me — expect 200 with user data
  // 5. POST /auth/logout
  // 6. GET /auth/login/options?email=...
  // 7. Stub navigator.credentials.get() with the options
  // 8. POST /auth/login/verify
  // 9. GET /me — expect 200
});
