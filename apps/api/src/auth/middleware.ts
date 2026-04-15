// SPDX-License-Identifier: AGPL-3.0-only
import type { Context, Next } from "hono";
import { eq } from "drizzle-orm";
import { users, passkeys } from "@ploydok/db";
import { verifyAccessToken, ACCESS_COOKIE } from "./jwt";
import { countActive } from "./backup-codes";
import type { Db } from "@ploydok/db";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Types stored in context
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
  session_id: string;
}

// Hono context variable types
export interface AppVariables {
  user: AuthUser;
  session_id: string;
}

// ---------------------------------------------------------------------------
// requireAuth
// ---------------------------------------------------------------------------

/**
 * Reads the ploydok_access cookie, verifies the JWT, loads the user from DB,
 * and attaches it to c.set('user', ...) and c.set('session_id', ...).
 *
 * Returns 401 if missing, expired, or tampered.
 */
export function requireAuth(db: Db) {
  return async (c: Context, next: Next) => {
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

    const userId = payload.sub;
    if (!userId) {
      return c.json(
        { error: { code: "UNAUTHENTICATED", message: "Invalid token payload" } },
        401,
      );
    }

    // Load user from DB
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const user = rows[0];
    if (!user) {
      return c.json(
        { error: { code: "UNAUTHENTICATED", message: "User not found" } },
        401,
      );
    }

    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
      session_id: payload.session_id,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c as any).set("user", authUser);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c as any).set("session_id", payload.session_id);

    return next();
  };
}

// ---------------------------------------------------------------------------
// requireSecondFactor
// ---------------------------------------------------------------------------

/**
 * Must be called after requireAuth.
 * Blocks with 403 SECOND_FACTOR_REQUIRED if user has:
 * - fewer than 2 passkeys, AND
 * - 0 non-consumed backup codes.
 */
export function requireSecondFactor(db: Db) {
  return async (c: Context, next: Next) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (c as any).get("user") as AuthUser | undefined;
    if (!user) {
      return c.json(
        { error: { code: "UNAUTHENTICATED", message: "Authentication required" } },
        401,
      );
    }

    // Count passkeys
    const passkeyRows = await db
      .select({ id: passkeys.id })
      .from(passkeys)
      .where(eq(passkeys.user_id, user.id));

    const passkeyCount = passkeyRows.length;
    const backupCount = await countActive(db, user.id);

    if (passkeyCount >= 2 || backupCount >= 1) {
      return next();
    }

    return c.json(
      { error: { code: "SECOND_FACTOR_REQUIRED", message: "A second factor is required" } },
      403,
    );
  };
}
