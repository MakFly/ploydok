// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { requireAuth, requireSecondFactor } from "./middleware";
import { signAccessToken, buildCookieStr, ACCESS_COOKIE, ACCESS_MAX_AGE } from "./jwt";
import { users, passkeys, backup_codes, totp_secrets } from "@ploydok/db";
import type { Db } from "@ploydok/db";
import { nanoid } from "nanoid";
import { makeTestDb, TEST_PG_URL } from "../test/db-helpers";

const skip = !TEST_PG_URL;
if (skip) console.log("[middleware.test] PLOYDOK_TEST_PG_URL not set — skipping");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(skip)("requireAuth middleware", () => {
  let db: Db;
  let userId: string;

  beforeEach(async () => {
    const result = await makeTestDb();
    db = result.db;
    userId = `mw-${nanoid(6)}`;
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

describe.skipIf(skip)("requireSecondFactor middleware", () => {
  let db: Db;
  let userId: string;

  beforeEach(async () => {
    const result = await makeTestDb();
    db = result.db;
    userId = `sf-${nanoid(6)}`;
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
        id: nanoid(), user_id: userId, credential_id: `cred-1-${userId}`,
        public_key: Buffer.from("pk1"), counter: 0, transports: "[]",
        device_name: "Device 1", created_at: now, last_used_at: now,
      },
      {
        id: nanoid(), user_id: userId, credential_id: `cred-2-${userId}`,
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
      id: nanoid(), user_id: userId, credential_id: `cred-3-${userId}`,
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

  it("returns 200 when user has TOTP verified (no passkeys, no backup codes)", async () => {
    const now = new Date();
    await db.insert(totp_secrets).values({
      id: nanoid(),
      user_id: userId,
      secret_encrypted: JSON.stringify({ enc: "dGVzdA==", nonce: "bm9uY2U=" }),
      verified_at: now,
      created_at: now,
    });

    const { app, token } = await makeApp();
    const res = await app.request("/secure", {
      headers: { cookie: `${ACCESS_COOKIE}=${encodeURIComponent(token)}` },
    });
    expect(res.status).toBe(200);
  });

  it("returns 403 when user has TOTP enrolled but not yet verified", async () => {
    const now = new Date();
    await db.insert(totp_secrets).values({
      id: nanoid(),
      user_id: userId,
      secret_encrypted: JSON.stringify({ enc: "dGVzdA==", nonce: "bm9uY2U=" }),
      verified_at: null,
      created_at: now,
    });

    const { app, token } = await makeApp();
    const res = await app.request("/secure", {
      headers: { cookie: `${ACCESS_COOKIE}=${encodeURIComponent(token)}` },
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("SECOND_FACTOR_REQUIRED");
  });
});
