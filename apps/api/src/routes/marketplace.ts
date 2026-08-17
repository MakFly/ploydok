// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono"
import {
  getCatalog,
  getTemplateFiles,
  isSafeTemplateId,
  matchesQuery,
  UpstreamUnavailableError,
} from "../marketplace/catalog"

const DEFAULT_LIMIT = 24
const MAX_LIMIT = 100

function parseCursor(raw: string | undefined): number {
  const n = Number(raw ?? 0)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.floor(n)
}

function parseLimit(raw: string | undefined): number {
  const n = Number(raw ?? DEFAULT_LIMIT)
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT
  return Math.min(Math.floor(n), MAX_LIMIT)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createMarketplaceRouter(): Hono<any, any, any> {
  const router = new Hono()

  // GET /marketplace/templates?q=&cursor=&limit=
  router.get("/templates", async (c) => {
    let catalog
    try {
      catalog = await getCatalog()
    } catch (err) {
      if (err instanceof UpstreamUnavailableError) {
        return c.json(
          {
            error: {
              code: "UPSTREAM_UNAVAILABLE",
              message: "Template registry is unreachable",
            },
          },
          503
        )
      }
      throw err
    }

    const q = (c.req.query("q") ?? "").trim().toLowerCase()
    const cursor = parseCursor(c.req.query("cursor"))
    const limit = parseLimit(c.req.query("limit"))

    const filtered = q
      ? catalog.templates.filter((tpl) => matchesQuery(tpl, q))
      : catalog.templates

    const templates = filtered.slice(cursor, cursor + limit)
    const next = cursor + limit
    return c.json({
      templates,
      nextCursor: next < filtered.length ? next : null,
      total: filtered.length,
      stale: catalog.stale,
    })
  })

  // GET /marketplace/templates/:id
  router.get("/templates/:id", async (c) => {
    const id = c.req.param("id")
    if (!id || !isSafeTemplateId(id)) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: "Invalid template id" } },
        400
      )
    }

    // Membership check against the catalog: the id ends up in an upstream URL,
    // so only ids the registry actually advertises are allowed through.
    try {
      const catalog = await getCatalog()
      if (!catalog.templates.some((tpl) => tpl.id === id)) {
        return c.json(
          { error: { code: "NOT_FOUND", message: "Template not found" } },
          404
        )
      }
      const files = await getTemplateFiles(id)
      return c.json(files)
    } catch (err) {
      if (err instanceof UpstreamUnavailableError) {
        return c.json(
          {
            error: {
              code: "UPSTREAM_UNAVAILABLE",
              message: "Template registry is unreachable",
            },
          },
          503
        )
      }
      throw err
    }
  })

  return router
}
