// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "crypto"
import { Hono } from "hono"
import type { Db } from "@ploydok/db"
import {
  createToken,
  listTokensForUser,
  revokeToken,
} from "@ploydok/db/queries"
import { ApiTokenCreateSchema } from "@ploydok/shared"
import { childLogger } from "../logger"
import type { AuthUser } from "../auth/middleware"

const log = childLogger("api-tokens.routes")

type AppEnv = { Variables: { user?: AuthUser } }

function getUser(c: { get: (k: string) => unknown }): AuthUser {
  return c.get("user") as AuthUser
}

function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const base64url = Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "")
  return `ploy_${base64url}`
}

export function createApiTokensRouter(db: Db): Hono<AppEnv> {
  const router = new Hono<AppEnv>()

  router.post("/", async (c) => {
    const user = getUser(c)
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401)
    }

    const body = await c.req.json()
    const parseResult = ApiTokenCreateSchema.safeParse(body)

    if (!parseResult.success) {
      return c.json({ error: "Invalid request body" }, 400)
    }

    const { name, expiresInDays } = parseResult.data

    const token = generateToken()
    const tokenHash = createHash("sha256").update(token).digest("hex")

    const tokenParams: {
      userId: string
      name: string
      tokenHash: string
      expiresAt?: Date
    } = {
      userId: user.id,
      name,
      tokenHash,
    }

    if (expiresInDays) {
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + expiresInDays)
      tokenParams.expiresAt = expiresAt
    }

    const row = await createToken(db, tokenParams)

    const summary = {
      id: row.id,
      name: row.name,
      created_at: row.created_at,
      last_used_at: row.last_used_at,
      expires_at: row.expires_at,
      revoked_at: row.revoked_at,
    }

    return c.json({ token, row: summary }, 201)
  })

  router.get("/", async (c) => {
    const user = getUser(c)
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401)
    }

    const tokens = await listTokensForUser(db, user.id)

    return c.json({ tokens })
  })

  router.delete("/:id", async (c) => {
    const user = getUser(c)
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401)
    }

    const tokenId = c.req.param("id")

    await revokeToken(db, user.id, tokenId)

    return c.json({ success: true })
  })

  return router
}
