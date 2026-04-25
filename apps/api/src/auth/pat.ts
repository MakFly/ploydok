// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "crypto"
import type { Context, Next } from "hono"
import type { Db } from "@ploydok/db"
import {
  getActiveToken,
  updateTokenLastUsed,
  getUser,
} from "@ploydok/db/queries"

export async function patAuthMiddleware(
  c: Context,
  next: Next,
  db: Db
): Promise<void> {
  const authHeader = c.req.header("Authorization")

  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7)

    if (token.startsWith("ploy_")) {
      const hash = createHash("sha256").update(token).digest("hex")
      const activeToken = await getActiveToken(db, hash)

      if (activeToken) {
        const user = await getUser(db, activeToken.user_id)
        if (user) {
          c.set("user", {
            id: user.id,
            email: user.email,
            display_name: user.display_name,
            session_id: activeToken.id,
          })
          await updateTokenLastUsed(db, activeToken.id, new Date())
        }
      }
    }
  }

  await next()
}
