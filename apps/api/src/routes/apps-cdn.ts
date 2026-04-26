// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono"
import { z } from "zod"
import { eq } from "drizzle-orm"
import { apps } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { CdnConfigSchema } from "@ploydok/shared"
import { getAppForUser } from "@ploydok/db/queries"
import { childLogger } from "../logger"
import type { AuthUser } from "../auth/middleware"

const log = childLogger("cdn")

const CdnPatchBody = CdnConfigSchema.omit({
  headers: true,
}).extend({
  headers: z.record(z.string().regex(/^[A-Za-z-]+$/), z.string()).optional(),
})

function getUser(c: { get: (key: string) => unknown }): AuthUser {
  return c.get("user") as AuthUser
}

export function createCdnRouter(db: Db): Hono {
  const router = new Hono()

  router.get("/:id/cdn", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    const config = {
      mode: app.cdn_mode,
      cache_ttl_s: app.cdn_cache_ttl_s ?? 300,
      cache_paths: app.cdn_cache_paths ?? [],
      compression: app.cdn_compression,
      image_optim: app.cdn_image_optim,
      headers: app.cdn_headers
        ? (() => {
            try {
              return JSON.parse(app.cdn_headers)
            } catch {
              return {}
            }
          })()
        : {},
      external_provider: app.cdn_external_provider ?? undefined,
    }

    return c.json(config)
  })

  router.put("/:id/cdn", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json(
        { error: { code: "INVALID_JSON", message: "Invalid JSON" } },
        400
      )
    }

    const parsed = CdnPatchBody.safeParse(body)
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: String(parsed.error),
          },
        },
        400
      )
    }

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    const config = parsed.data

    const updateData: Partial<typeof apps.$inferInsert> = {
      cdn_mode: config.mode ?? "off",
      cdn_cache_ttl_s: config.cache_ttl_s ?? 300,
      cdn_cache_paths: config.cache_paths ?? [],
      cdn_compression: config.compression ?? false,
      cdn_image_optim: config.image_optim ?? false,
      cdn_headers: config.headers ? JSON.stringify(config.headers) : null,
      cdn_external_provider: config.external_provider ?? null,
    }

    await db.update(apps).set(updateData).where(eq(apps.id, appId))

    log.info({ appId, config: updateData }, "cdn config updated")

    return c.json({ success: true, config: updateData })
  })

  return router
}
