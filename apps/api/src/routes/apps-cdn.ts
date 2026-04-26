// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono"
import type { Db } from "@ploydok/db"
import { getAppForUser } from "@ploydok/db/queries"
import type { AuthUser } from "../auth/middleware"

function getUser(c: { get: (key: string) => unknown }): AuthUser {
  return c.get("user") as AuthUser
}

const defaultCdnConfig = {
  mode: "off",
  cache_ttl_s: 300,
  cache_paths: [],
  compression: false,
  image_optim: false,
  headers: {},
  external_provider: null,
  ready: false,
} as const

export function createCdnRouter(db: Db): Hono {
  const router = new Hono()

  router.get("/:id/cdn", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")!

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    return c.json(defaultCdnConfig)
  })

  router.put("/:id/cdn", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")!

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    return c.json(
      {
        error: {
          code: "FEATURE_NOT_READY",
          message: "CDN controls require the Sprint 7 schema migration.",
        },
      },
      501
    )
  })

  return router
}
