// SPDX-License-Identifier: AGPL-3.0-only
import type { Context, Next } from "hono"
import { tokenHasScope } from "@ploydok/shared"
import type { AuthUser } from "./middleware"

/**
 * Middleware factory : exige qu'un token PAT ait un scope donné.
 *
 * Une session cookie classique (sans `token_scopes`) passe (équivalent à
 * `admin:*`) — l'UI web a accès complet via session. Le scope check ne
 * s'applique qu'aux PAT.
 */
export function requireScope(required: string) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const user = c.get("user") as AuthUser | undefined

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

    if (!user.token_scopes) {
      // Session cookie — bypass.
      await next()
      return
    }

    if (!tokenHasScope(user.token_scopes, required)) {
      return c.json(
        {
          error: {
            code: "FORBIDDEN",
            message: `Token missing required scope: ${required}`,
          },
        },
        403
      )
    }

    await next()
  }
}

export function requireAnyScope(requiredScopes: readonly string[]) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const user = c.get("user") as AuthUser | undefined

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

    if (!user.token_scopes) {
      await next()
      return
    }

    if (
      !requiredScopes.some((required) =>
        tokenHasScope(user.token_scopes ?? [], required)
      )
    ) {
      return c.json(
        {
          error: {
            code: "FORBIDDEN",
            message: `Token missing one of required scopes: ${requiredScopes.join(", ")}`,
          },
        },
        403
      )
    }

    await next()
  }
}
