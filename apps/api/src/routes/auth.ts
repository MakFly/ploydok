// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono";
import { nanoid } from "nanoid";
import { eq, and, ne } from "drizzle-orm";
import { users, passkeys, sessions as sessionsTable } from "@ploydok/db";
import type { Db } from "@ploydok/db";
import { env } from "../env";
import {
  generateRegOptions,
  verifyRegResponse,
  generateAuthOptions,
  verifyAuthResponse,
} from "../auth/webauthn";
import {
  signAccessToken,
  verifyAccessToken,
  buildCookieStr,
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  ACCESS_MAX_AGE,
  REFRESH_MAX_AGE,
} from "../auth/jwt";
import * as BackupCodes from "../auth/backup-codes";
import * as Sessions from "../auth/sessions";
import { setChallenge, consumeChallenge } from "../auth/challenges";
import { requireAuth, type AuthUser } from "../auth/middleware";
// AuthenticatorTransportFuture is re-exported from @simplewebauthn/server internals
// We use a simple string type alias to avoid the missing @simplewebauthn/types package
type AuthenticatorTransportFuture =
  | "ble"
  | "cable"
  | "hybrid"
  | "internal"
  | "nfc"
  | "smart-card"
  | "usb";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isSecure = env.NODE_ENV === "prod";

function setCookies(
  headers: Headers,
  accessToken: string,
  refreshToken: string,
  sessionId: string,
): void {
  headers.append(
    "Set-Cookie",
    buildCookieStr(ACCESS_COOKIE, accessToken, ACCESS_MAX_AGE, isSecure),
  );
  // Refresh cookie value: sessionId:rawToken
  const refreshValue = `${sessionId}:${refreshToken}`;
  headers.append(
    "Set-Cookie",
    buildCookieStr(REFRESH_COOKIE, refreshValue, REFRESH_MAX_AGE, isSecure),
  );
}

function clearCookies(headers: Headers): void {
  headers.append("Set-Cookie", buildCookieStr(ACCESS_COOKIE, "", 0, isSecure));
  headers.append("Set-Cookie", buildCookieStr(REFRESH_COOKIE, "", 0, isSecure));
}

function parseCookies(cookieHeader: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function getClientInfo(req: Request): { userAgent: string; ip: string } {
  return {
    userAgent: req.headers.get("user-agent") ?? "unknown",
    ip: req.headers.get("x-forwarded-for") ?? "unknown",
  };
}

async function getUserMeta(db: Db, userId: string) {
  const passkeyRows = await db
    .select({ id: passkeys.id })
    .from(passkeys)
    .where(eq(passkeys.user_id, userId));
  const passkeyCount = passkeyRows.length;
  const backupCount = await BackupCodes.countActive(db, userId);
  return {
    has_passkey_plus: passkeyCount >= 2,
    has_backup_codes: backupCount >= 1,
    needs_second_factor: passkeyCount < 2 && backupCount < 1,
  };
}

// Cast to bypass Hono's strict context variable typing without a full typed app
// (app.ts sets up the Hono instance; routes receive generic Context)
function getUser(c: { get: (key: string) => unknown }): AuthUser {
  return c.get("user") as AuthUser;
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function createAuthRouter(db: Db): Hono {
  const auth = new Hono();

  // -------------------------------------------------------------------------
  // GET /auth/register/options
  // First boot: create user from query params. Otherwise: requireAuth.
  // -------------------------------------------------------------------------
  auth.get("/auth/register/options", async (c) => {
    const userCount = await db.select({ id: users.id }).from(users).limit(1);
    const isFirstBoot = userCount.length === 0;

    let userId: string;
    let userEmail: string;
    let userDisplayName: string;

    if (isFirstBoot) {
      const email = c.req.query("email");
      const display_name = c.req.query("display_name");
      if (!email || !display_name) {
        return c.json(
          {
            error: {
              code: "BAD_REQUEST",
              message: "email and display_name required for first boot",
            },
          },
          400,
        );
      }
      const existing = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (existing[0]) {
        userId = existing[0].id;
        userEmail = existing[0].email;
        userDisplayName = existing[0].display_name;
      } else {
        const now = new Date();
        userId = nanoid();
        userEmail = email;
        userDisplayName = display_name;
        await db.insert(users).values({
          id: userId,
          email: userEmail,
          display_name: userDisplayName,
          created_at: now,
          updated_at: now,
          recovery_token_hash: null,
          recovery_expires_at: null,
        });
      }
    } else {
      // Require auth
      const cookieHeader = c.req.raw.headers.get("cookie") ?? "";
      const cookies = parseCookies(cookieHeader);
      const token = cookies[ACCESS_COOKIE];
      if (!token) {
        return c.json(
          { error: { code: "UNAUTHENTICATED", message: "Authentication required" } },
          401,
        );
      }
      let payload;
      try {
        payload = await verifyAccessToken(token);
      } catch {
        return c.json(
          { error: { code: "UNAUTHENTICATED", message: "Invalid or expired token" } },
          401,
        );
      }
      if (!payload.sub) {
        return c.json({ error: { code: "UNAUTHENTICATED", message: "Invalid token" } }, 401);
      }
      const userRows = await db
        .select()
        .from(users)
        .where(eq(users.id, payload.sub))
        .limit(1);
      const user = userRows[0];
      if (!user) {
        return c.json({ error: { code: "UNAUTHENTICATED", message: "User not found" } }, 401);
      }
      userId = user.id;
      userEmail = user.email;
      userDisplayName = user.display_name;
    }

    // Get existing credentials to exclude them
    const existingPasskeys = await db
      .select({ credential_id: passkeys.credential_id, transports: passkeys.transports })
      .from(passkeys)
      .where(eq(passkeys.user_id, userId));

    const excludeCredentials = existingPasskeys.map((pk) => ({
      id: pk.credential_id,
      type: "public-key" as const,
      transports: JSON.parse(pk.transports) as AuthenticatorTransportFuture[],
    }));

    const options = await generateRegOptions({
      userName: userEmail,
      userDisplayName: userDisplayName,
      userID: new TextEncoder().encode(userId),
      excludeCredentials,
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
    });

    setChallenge(`reg:${userId}`, options.challenge);

    return c.json({ options, userId });
  });

  // -------------------------------------------------------------------------
  // POST /auth/register/verify
  // -------------------------------------------------------------------------
  auth.post("/auth/register/verify", async (c) => {
    const body = (await c.req.json()) as {
      userId: string;
      credential: unknown;
      device_name?: string;
    };

    if (!body.userId) {
      return c.json({ error: { code: "BAD_REQUEST", message: "userId required" } }, 400);
    }

    const expectedChallenge = consumeChallenge(`reg:${body.userId}`);
    if (!expectedChallenge) {
      return c.json(
        { error: { code: "CHALLENGE_EXPIRED", message: "Challenge expired or not found" } },
        400,
      );
    }

    let verification;
    try {
      verification = await verifyRegResponse({
        response: body.credential as Parameters<typeof verifyRegResponse>[0]["response"],
        expectedChallenge,
      });
    } catch (err) {
      return c.json({ error: { code: "VERIFICATION_FAILED", message: String(err) } }, 400);
    }

    if (!verification.verified || !verification.registrationInfo) {
      return c.json(
        { error: { code: "VERIFICATION_FAILED", message: "Attestation not verified" } },
        400,
      );
    }

    const { credential } = verification.registrationInfo;

    const now = new Date();
    await db.insert(passkeys).values({
      id: nanoid(),
      user_id: body.userId,
      credential_id: credential.id,
      public_key: Buffer.from(credential.publicKey),
      counter: credential.counter,
      transports: JSON.stringify(credential.transports ?? []),
      device_name: body.device_name ?? null,
      created_at: now,
      last_used_at: now,
    });

    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.id, body.userId))
      .limit(1);
    const user = userRows[0];
    if (!user) {
      return c.json({ error: { code: "NOT_FOUND", message: "User not found" } }, 404);
    }

    const { userAgent, ip } = getClientInfo(c.req.raw);
    const { sessionId, refreshToken } = await Sessions.createSession(db, {
      userId: body.userId,
      userAgent,
      ip,
    });

    const accessToken = await signAccessToken({
      userId: body.userId,
      email: user.email,
      sessionId,
    });

    const meta = await getUserMeta(db, body.userId);

    const response = c.newResponse(
      JSON.stringify({
        user: { id: user.id, email: user.email, display_name: user.display_name },
        ...meta,
      }),
      200,
      { "Content-Type": "application/json" },
    );
    setCookies(response.headers, accessToken, refreshToken, sessionId);
    return response;
  });

  // -------------------------------------------------------------------------
  // GET /auth/login/options
  // -------------------------------------------------------------------------
  auth.get("/auth/login/options", async (c) => {
    const email = c.req.query("email");

    let userId: string | undefined;

    if (email) {
      const userRows = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      const user = userRows[0];
      if (user) {
        userId = user.id;
      }
    }

    let options;
    if (userId) {
      const userPasskeys = await db
        .select({ credential_id: passkeys.credential_id, transports: passkeys.transports })
        .from(passkeys)
        .where(eq(passkeys.user_id, userId));

      const allowCredentials = userPasskeys.map((pk) => ({
        id: pk.credential_id,
        type: "public-key" as const,
        transports: JSON.parse(pk.transports) as AuthenticatorTransportFuture[],
      }));

      options = await generateAuthOptions({
        allowCredentials,
        userVerification: "preferred",
      });
    } else {
      // Usernameless or user not found — don't reveal non-existence
      options = await generateAuthOptions({ userVerification: "preferred" });
    }

    const challengeKey = userId
      ? `auth:${userId}`
      : `auth:anon:${options.challenge.slice(0, 16)}`;
    setChallenge(challengeKey, options.challenge);

    return c.json({ options, _challengeKey: challengeKey });
  });

  // -------------------------------------------------------------------------
  // POST /auth/login/verify
  // -------------------------------------------------------------------------
  auth.post("/auth/login/verify", async (c) => {
    const body = (await c.req.json()) as {
      credential: { id: string };
      _challengeKey: string;
    };

    if (!body._challengeKey) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: "_challengeKey required" } },
        400,
      );
    }

    const expectedChallenge = consumeChallenge(body._challengeKey);
    if (!expectedChallenge) {
      return c.json(
        { error: { code: "CHALLENGE_EXPIRED", message: "Challenge expired or not found" } },
        400,
      );
    }

    const passkeyRows = await db
      .select()
      .from(passkeys)
      .where(eq(passkeys.credential_id, body.credential.id))
      .limit(1);

    const passkey = passkeyRows[0];
    if (!passkey) {
      return c.json({ error: { code: "NOT_FOUND", message: "Passkey not found" } }, 404);
    }

    let verification;
    try {
      verification = await verifyAuthResponse({
        response: body.credential as Parameters<typeof verifyAuthResponse>[0]["response"],
        expectedChallenge,
        credential: {
          id: passkey.credential_id,
          publicKey: new Uint8Array(passkey.public_key),
          counter: passkey.counter,
          transports: JSON.parse(passkey.transports) as AuthenticatorTransportFuture[],
        },
        requireUserVerification: false,
      });
    } catch (err) {
      return c.json({ error: { code: "VERIFICATION_FAILED", message: String(err) } }, 400);
    }

    if (!verification.verified) {
      return c.json(
        { error: { code: "VERIFICATION_FAILED", message: "Assertion not verified" } },
        400,
      );
    }

    await db
      .update(passkeys)
      .set({
        counter: verification.authenticationInfo.newCounter,
        last_used_at: new Date(),
      })
      .where(eq(passkeys.id, passkey.id));

    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.id, passkey.user_id))
      .limit(1);
    const user = userRows[0];
    if (!user) {
      return c.json({ error: { code: "NOT_FOUND", message: "User not found" } }, 404);
    }

    const { userAgent, ip } = getClientInfo(c.req.raw);
    const { sessionId, refreshToken } = await Sessions.createSession(db, {
      userId: user.id,
      userAgent,
      ip,
    });

    const accessToken = await signAccessToken({
      userId: user.id,
      email: user.email,
      sessionId,
    });

    const meta = await getUserMeta(db, user.id);

    const response = c.newResponse(
      JSON.stringify({
        user: { id: user.id, email: user.email, display_name: user.display_name },
        ...meta,
      }),
      200,
      { "Content-Type": "application/json" },
    );
    setCookies(response.headers, accessToken, refreshToken, sessionId);
    return response;
  });

  // -------------------------------------------------------------------------
  // POST /auth/logout
  // -------------------------------------------------------------------------
  auth.post("/auth/logout", requireAuth(db), async (c) => {
    const user = getUser(c);
    await Sessions.revokeSession(db, user.session_id);
    const response = c.newResponse(null, 204);
    clearCookies(response.headers);
    return response;
  });

  // -------------------------------------------------------------------------
  // POST /auth/refresh
  // -------------------------------------------------------------------------
  auth.post("/auth/refresh", async (c) => {
    const cookieHeader = c.req.raw.headers.get("cookie") ?? "";
    const cookies = parseCookies(cookieHeader);
    const refreshCookie = cookies[REFRESH_COOKIE];

    if (!refreshCookie) {
      return c.json(
        { error: { code: "UNAUTHENTICATED", message: "No refresh token" } },
        401,
      );
    }

    const colonIdx = refreshCookie.indexOf(":");
    if (colonIdx === -1) {
      return c.json(
        { error: { code: "UNAUTHENTICATED", message: "Invalid refresh token format" } },
        401,
      );
    }
    const sessionId = refreshCookie.slice(0, colonIdx);
    const rawToken = refreshCookie.slice(colonIdx + 1);

    const session = await Sessions.verifyRefreshToken(db, sessionId, rawToken);
    if (!session) {
      return c.json(
        { error: { code: "UNAUTHENTICATED", message: "Invalid or expired refresh token" } },
        401,
      );
    }

    const newRefreshToken = await Sessions.rotateRefreshToken(db, sessionId);

    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.id, session.user_id))
      .limit(1);
    const user = userRows[0];
    if (!user) {
      return c.json({ error: { code: "NOT_FOUND", message: "User not found" } }, 404);
    }

    const accessToken = await signAccessToken({
      userId: user.id,
      email: user.email,
      sessionId,
    });

    const response = c.newResponse(
      JSON.stringify({ ok: true }),
      200,
      { "Content-Type": "application/json" },
    );
    setCookies(response.headers, accessToken, newRefreshToken, sessionId);
    return response;
  });

  // -------------------------------------------------------------------------
  // POST /auth/backup-codes/generate
  // -------------------------------------------------------------------------
  auth.post("/auth/backup-codes/generate", requireAuth(db), async (c) => {
    const user = getUser(c);
    const codes = await BackupCodes.regenerate(db, user.id);

    // TXT download — see ADR 0002
    const txt = [
      "Ploydok Backup Codes",
      "====================",
      `User: ${user.email}`,
      `Generated: ${new Date().toISOString()}`,
      "",
      "Store these codes in a safe place. Each code can only be used once.",
      "",
      ...codes.map((code, i) => `${i + 1}. ${code}`),
      "",
      "IMPORTANT: These codes will not be shown again.",
    ].join("\n");

    return new Response(txt, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="ploydok-backup-codes.txt"`,
      },
    });
  });

  // -------------------------------------------------------------------------
  // POST /auth/backup-codes/consume
  // -------------------------------------------------------------------------
  auth.post("/auth/backup-codes/consume", async (c) => {
    const body = (await c.req.json()) as { email: string; code: string };
    if (!body.email || !body.code) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: "email and code required" } },
        400,
      );
    }

    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1);
    const user = userRows[0];
    if (!user) {
      return c.json(
        { error: { code: "INVALID_CODE", message: "Invalid backup code" } },
        401,
      );
    }

    const ok = await BackupCodes.consume(db, user.id, body.code.trim().toUpperCase());
    if (!ok) {
      return c.json(
        { error: { code: "INVALID_CODE", message: "Invalid or already used backup code" } },
        401,
      );
    }

    const { userAgent, ip } = getClientInfo(c.req.raw);
    const { sessionId, refreshToken } = await Sessions.createSession(db, {
      userId: user.id,
      userAgent,
      ip,
    });

    const accessToken = await signAccessToken({
      userId: user.id,
      email: user.email,
      sessionId,
    });
    const meta = await getUserMeta(db, user.id);

    const response = c.newResponse(
      JSON.stringify({
        user: { id: user.id, email: user.email, display_name: user.display_name },
        ...meta,
      }),
      200,
      { "Content-Type": "application/json" },
    );
    setCookies(response.headers, accessToken, refreshToken, sessionId);
    return response;
  });

  // -------------------------------------------------------------------------
  // GET /auth/passkeys
  // -------------------------------------------------------------------------
  auth.get("/auth/passkeys", requireAuth(db), async (c) => {
    const user = getUser(c);
    const rows = await db
      .select({
        id: passkeys.id,
        credential_id: passkeys.credential_id,
        device_name: passkeys.device_name,
        created_at: passkeys.created_at,
        last_used_at: passkeys.last_used_at,
      })
      .from(passkeys)
      .where(eq(passkeys.user_id, user.id));

    return c.json({
      passkeys: rows.map((pk) => ({
        id: pk.id,
        credential_id: pk.credential_id,
        device_name: pk.device_name,
        created_at: pk.created_at?.toISOString(),
        last_used_at: pk.last_used_at?.toISOString(),
      })),
    });
  });

  // -------------------------------------------------------------------------
  // POST /auth/passkeys — add a new device
  // -------------------------------------------------------------------------
  auth.post("/auth/passkeys", requireAuth(db), async (c) => {
    const user = getUser(c);
    const body = (await c.req.json()) as { device_name?: string };

    const existingPasskeys = await db
      .select({ credential_id: passkeys.credential_id, transports: passkeys.transports })
      .from(passkeys)
      .where(eq(passkeys.user_id, user.id));

    const excludeCredentials = existingPasskeys.map((pk) => ({
      id: pk.credential_id,
      type: "public-key" as const,
      transports: JSON.parse(pk.transports) as AuthenticatorTransportFuture[],
    }));

    const options = await generateRegOptions({
      userName: user.email,
      userDisplayName: user.display_name,
      userID: new TextEncoder().encode(user.id),
      excludeCredentials,
      authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
    });

    setChallenge(`reg:${user.id}`, options.challenge);

    return c.json({ options, userId: user.id, device_name: body.device_name });
  });

  // -------------------------------------------------------------------------
  // DELETE /auth/passkeys/:id
  // -------------------------------------------------------------------------
  auth.delete("/auth/passkeys/:id", requireAuth(db), async (c) => {
    const user = getUser(c);
    const passkeyId = c.req.param("id") ?? "";

    if (!passkeyId) {
      return c.json({ error: { code: "BAD_REQUEST", message: "id required" } }, 400);
    }

    const target = await db
      .select()
      .from(passkeys)
      .where(and(eq(passkeys.id, passkeyId), eq(passkeys.user_id, user.id)))
      .limit(1);

    if (!target[0]) {
      return c.json({ error: { code: "NOT_FOUND", message: "Passkey not found" } }, 404);
    }

    const allPasskeys = await db
      .select({ id: passkeys.id })
      .from(passkeys)
      .where(eq(passkeys.user_id, user.id));

    if (allPasskeys.length <= 1) {
      const backupCount = await BackupCodes.countActive(db, user.id);
      if (backupCount < 1) {
        return c.json(
          {
            error: {
              code: "CANNOT_DELETE_LAST_PASSKEY",
              message: "Cannot delete the last passkey without active backup codes",
            },
          },
          409,
        );
      }
    }

    await db.delete(passkeys).where(eq(passkeys.id, passkeyId));
    return c.newResponse(null, 204);
  });

  // -------------------------------------------------------------------------
  // GET /auth/sessions
  // -------------------------------------------------------------------------
  auth.get("/auth/sessions", requireAuth(db), async (c) => {
    const user = getUser(c);
    const sessionList = await Sessions.listSessions(db, user.id);

    return c.json({
      sessions: sessionList.map((s) => ({
        id: s.id,
        user_agent: s.user_agent,
        ip: s.ip,
        created_at: s.created_at?.toISOString(),
        last_seen_at: s.last_seen_at?.toISOString(),
        expires_at: s.expires_at?.toISOString(),
        is_current: s.id === user.session_id,
      })),
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /auth/sessions/:id
  // -------------------------------------------------------------------------
  auth.delete("/auth/sessions/:id", requireAuth(db), async (c) => {
    const user = getUser(c);
    const targetId = c.req.param("id") ?? "";

    if (!targetId) {
      return c.json({ error: { code: "BAD_REQUEST", message: "id required" } }, 400);
    }

    if (targetId === user.session_id) {
      return c.json(
        {
          error: {
            code: "CANNOT_REVOKE_CURRENT",
            message: "Use /auth/logout to end current session",
          },
        },
        409,
      );
    }

    const rows = await db
      .select({ id: sessionsTable.id, user_id: sessionsTable.user_id })
      .from(sessionsTable)
      .where(eq(sessionsTable.id, targetId))
      .limit(1);

    const sessionRow = rows[0];
    if (!sessionRow || sessionRow.user_id !== user.id) {
      return c.json({ error: { code: "NOT_FOUND", message: "Session not found" } }, 404);
    }

    await Sessions.revokeSession(db, targetId);
    return c.newResponse(null, 204);
  });

  // -------------------------------------------------------------------------
  // POST /auth/sessions/revoke-others
  // -------------------------------------------------------------------------
  auth.post("/auth/sessions/revoke-others", requireAuth(db), async (c) => {
    const user = getUser(c);
    await Sessions.revokeOtherSessions(db, user.id, user.session_id);
    return c.json({ ok: true });
  });

  return auth;
}
