// SPDX-License-Identifier: AGPL-3.0-only
import type { Context, Next } from "hono"
import { eq } from "drizzle-orm"
import { users, passkeys, totp_secrets } from "@ploydok/db"
import { hasRole } from "@ploydok/db/queries"
import { verifyAccessToken, ACCESS_COOKIE } from "./jwt"
import { countActive } from "./backup-codes"
import type { Db } from "@ploydok/db"
import { authenticatePat } from "./pat"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseCookies(cookieHeader: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=")
    if (idx === -1) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    out[k] = decodeURIComponent(v)
  }
  return out
}

// ---------------------------------------------------------------------------
// Types stored in context
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string
  email: string
  display_name: string
  session_id: string
  /**
   * Scopes accordés par le PAT utilisé. Absent ⇒ session cookie classique
   * (équivaut à `["admin:*"]` côté checks de scope).
   */
  token_scopes?: string[]
  /**
   * id du PAT utilisé (présent uniquement si l'auth vient d'un Bearer plk_/ploy_).
   */
  pat_id?: string
}

// Hono context variable types
export interface AppVariables {
  user: AuthUser
  session_id: string
  access_exp: number
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
    const patResult = await authenticatePat(c, db)
    if (patResult.kind === "invalid") {
      return c.json(
        {
          error: {
            code: "UNAUTHENTICATED",
            message: "Invalid API token",
          },
        },
        401
      )
    }

    if (patResult.kind === "ok") {
      c.set("user", patResult.user)
      c.set("session_id", patResult.user.session_id)
      c.set("access_exp", 0)
      return next()
    }

    const cookieHeader = c.req.raw.headers.get("cookie") ?? ""
    const cookies = parseCookies(cookieHeader)
    const token = cookies[ACCESS_COOKIE]

    if (!token) {
      return c.json(
        {
          error: {
            code: "UNAUTHENTICATED",
            message: "Authentication required",
          },
        },
        401
      )
    }

    let payload
    try {
      payload = await verifyAccessToken(token)
    } catch {
      return c.json(
        {
          error: {
            code: "UNAUTHENTICATED",
            message: "Invalid or expired token",
          },
        },
        401
      )
    }

    const userId = payload.sub
    if (!userId) {
      return c.json(
        {
          error: { code: "UNAUTHENTICATED", message: "Invalid token payload" },
        },
        401
      )
    }

    // Load user from DB
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    const user = rows[0]
    if (!user) {
      return c.json(
        { error: { code: "UNAUTHENTICATED", message: "User not found" } },
        401
      )
    }

    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
      session_id: payload.session_id,
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(c as any).set("user", authUser)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(c as any).set("session_id", payload.session_id)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(c as any).set(
      "access_exp",
      typeof payload.exp === "number" ? payload.exp : 0
    )

    return next()
  }
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
    const user = (c as any).get("user") as AuthUser | undefined
    if (!user) {
      return c.json(
        {
          error: {
            code: "UNAUTHENTICATED",
            message: "Authentication required",
          },
        },
        401
      )
    }

    // Count passkeys
    const passkeyRows = await db
      .select({ id: passkeys.id })
      .from(passkeys)
      .where(eq(passkeys.user_id, user.id))

    const passkeyCount = passkeyRows.length
    const backupCount = await countActive(db, user.id)

    // Check TOTP verified
    const totpRows = await db
      .select({ verified_at: totp_secrets.verified_at })
      .from(totp_secrets)
      .where(eq(totp_secrets.user_id, user.id))
      .limit(1)
    const hasTotp = Boolean(totpRows[0]?.verified_at)

    if (passkeyCount >= 2 || backupCount >= 1 || hasTotp) {
      return next()
    }

    return c.json(
      {
        error: {
          code: "SECOND_FACTOR_REQUIRED",
          message: "A second factor is required",
        },
      },
      403
    )
  }
}

// ---------------------------------------------------------------------------
// requireRole
// ---------------------------------------------------------------------------

/**
 * Must be called after requireAuth.
 * Checks that the user has one of the required roles in the organization.
 * Resolves slug → project.id if needed.
 * Returns 403 FORBIDDEN if user does not have the required role.
 */
export function requireRole(db: Db, roles: Array<"owner" | "member">) {
  return async (c: Context, next: Next) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (c as any).get("user") as AuthUser | undefined
    if (!user) {
      return c.json(
        {
          error: {
            code: "UNAUTHENTICATED",
            message: "Authentication required",
          },
        },
        401
      )
    }

    // Try to get orgId from :slug or :orgId param
    const slugParam = c.req.param("slug")
    const idParam = c.req.param("orgId")
    let orgId = slugParam || idParam

    if (!orgId) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: "Organization ID required" } },
        400
      )
    }

    // If slug was passed, resolve it to project.id
    if (slugParam) {
      const { projects } = await import("@ploydok/db")
      const projectRows = await db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.slug, slugParam))
        .limit(1)

      if (!projectRows[0]) {
        return c.json(
          { error: { code: "NOT_FOUND", message: "Organization not found" } },
          404
        )
      }

      orgId = projectRows[0].id
    }

    const hasRequiredRole = await hasRole(db, orgId, user.id, roles)
    if (!hasRequiredRole) {
      return c.json(
        { error: { code: "FORBIDDEN", message: "Insufficient permissions" } },
        403
      )
    }

    return next()
  }
}
