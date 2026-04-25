// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "crypto"
import bcrypt from "bcryptjs"
import type { Context, Next } from "hono"
import type { Db } from "@ploydok/db"
import { audit_log } from "@ploydok/db"
import {
  getActiveToken,
  updateTokenLastUsed,
  getUser,
} from "@ploydok/db/queries"
import { childLogger } from "../logger"

const log = childLogger("pat")

/**
 * Middleware Bearer pour Personal Access Tokens.
 *
 * Accepte les formats `ploy_<base64url>` (legacy) et `plk_live_<base64url>`
 * (nouveau pattern documenté DoD Sprint 6.5-bis). Le hash stocké est SHA-256
 * du token complet — on calcule donc le hash sans tenir compte du préfixe.
 *
 * Si le token est valide :
 *  - injecte `user` dans le contexte (avec `token_scopes` + `pat_id`)
 *  - met à jour `last_used_at`
 *  - écrit une entrée audit log `api_token.used`
 */
export async function patAuthMiddleware(
  c: Context,
  next: Next,
  db: Db
): Promise<void> {
  const authHeader = c.req.header("Authorization")

  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7)

    if (token.startsWith("ploy_") || token.startsWith("plk_live_")) {
      const hash = createHash("sha256").update(token).digest("hex")
      const activeToken = await getActiveToken(db, hash)

      // Si bcrypt_hash présent (token créé Vague 2+), exige verify constant-time.
      // Sinon (legacy), le lookup SHA-256 unique-index suffit.
      let verified = !!activeToken
      if (activeToken && activeToken.bcrypt_hash) {
        verified = await bcrypt.compare(token, activeToken.bcrypt_hash)
      }

      if (activeToken && verified) {
        const user = await getUser(db, activeToken.user_id)
        if (user) {
          c.set("user", {
            id: user.id,
            email: user.email,
            display_name: user.display_name,
            session_id: activeToken.id,
            token_scopes: activeToken.scopes ?? ["admin:*"],
            pat_id: activeToken.id,
          })

          await updateTokenLastUsed(db, activeToken.id, new Date())

          // Audit log par appel — best-effort, ne bloque jamais la requête.
          try {
            await db.insert(audit_log).values({
              user_id: user.id,
              action: "api_token.used",
              target_type: "api_token",
              target_id: activeToken.id,
              metadata: JSON.stringify({
                method: c.req.method,
                path: new URL(c.req.url).pathname,
                scopes: activeToken.scopes ?? ["admin:*"],
              }),
              created_at: new Date(),
            })
          } catch (err) {
            log.warn(
              { err: (err as Error).message, token_id: activeToken.id },
              "audit_log.insert_failed"
            )
          }
        }
      }
    }
  }

  await next()
}
