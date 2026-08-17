// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import { createMarketplaceRouter } from "./marketplace"
import {
  expireCatalogCacheForTests,
  resetCatalogCacheForTests,
} from "../marketplace/catalog"

const realFetch = globalThis.fetch

function upstreamTemplate(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: id.toUpperCase(),
    description: `${id} description`,
    version: "1.0.0",
    logo: "logo.png",
    tags: [id.slice(0, 3)],
    links: { github: `https://github.com/${id}` },
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  })
}

async function get(path: string): Promise<Response> {
  const router = createMarketplaceRouter()
  return await router.fetch(new Request(`http://localhost${path}`))
}

describe("marketplace router", () => {
  beforeEach(() => {
    resetCatalogCacheForTests()
  })

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it("paginates the catalog with a cursor", async () => {
    const catalog = Array.from({ length: 30 }, (_, i) =>
      upstreamTemplate(`tpl-${String(i).padStart(2, "0")}`)
    )
    globalThis.fetch = mock(() => Promise.resolve(jsonResponse(catalog))) as any

    const first = await get("/templates?limit=10&cursor=0")
    expect(first.status).toBe(200)
    const firstBody = (await first.json()) as any
    expect(firstBody.templates).toHaveLength(10)
    expect(firstBody.total).toBe(30)
    expect(firstBody.nextCursor).toBe(10)
    expect(firstBody.stale).toBe(false)

    const last = await get("/templates?limit=10&cursor=20")
    const lastBody = (await last.json()) as any
    expect(lastBody.templates).toHaveLength(10)
    expect(lastBody.nextCursor).toBeNull()
  })

  it("filters server-side across the whole catalog, not just the first page", async () => {
    const catalog = [
      ...Array.from({ length: 40 }, (_, i) => upstreamTemplate(`filler-${i}`)),
      upstreamTemplate("needle", { tags: ["searchable"] }),
    ]
    globalThis.fetch = mock(() => Promise.resolve(jsonResponse(catalog))) as any

    const res = await get("/templates?q=needle&limit=10")
    const body = (await res.json()) as any
    expect(body.total).toBe(1)
    expect(body.templates[0].id).toBe("needle")
    expect(body.nextCursor).toBeNull()
  })

  it("matches on tags too", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        jsonResponse([upstreamTemplate("alpha", { tags: ["database"] })])
      )
    ) as any

    const res = await get("/templates?q=datab")
    const body = (await res.json()) as any
    expect(body.total).toBe(1)
  })

  it("serves the stale cache when upstream goes down", async () => {
    const catalog = [upstreamTemplate("alpha")]
    globalThis.fetch = mock(() => Promise.resolve(jsonResponse(catalog))) as any

    const warm = await get("/templates")
    expect(((await warm.json()) as any).stale).toBe(false)

    // Expire the TTL but keep the data, then break upstream.
    expireCatalogCacheForTests()
    globalThis.fetch = mock(() =>
      Promise.reject(new Error("ECONNREFUSED"))
    ) as any

    const degraded = await get("/templates")
    expect(degraded.status).toBe(200)
    const body = (await degraded.json()) as any
    expect(body.stale).toBe(true)
    expect(body.templates).toHaveLength(1)
  })

  it("returns 503 when upstream is down and nothing is cached", async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new Error("ECONNREFUSED"))
    ) as any

    const res = await get("/templates")
    expect(res.status).toBe(503)
    const body = (await res.json()) as any
    expect(body.error.code).toBe("UPSTREAM_UNAVAILABLE")
  })

  it("skips malformed upstream entries instead of failing the catalog", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        jsonResponse([
          upstreamTemplate("good"),
          { id: 42, name: null },
          { nope: true },
        ])
      )
    ) as any

    const res = await get("/templates")
    const body = (await res.json()) as any
    expect(body.total).toBe(1)
    expect(body.templates[0].id).toBe("good")
  })

  it("rejects a traversal-shaped template id", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(jsonResponse([upstreamTemplate("alpha")]))
    ) as any

    const res = await get("/templates/..%2F..%2Fetc%2Fpasswd")
    expect(res.status).toBe(400)
  })

  it("404s a template id absent from the catalog", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(jsonResponse([upstreamTemplate("alpha")]))
    ) as any

    const res = await get("/templates/ghost")
    expect(res.status).toBe(404)
  })

  it("returns template files for a catalog member", async () => {
    globalThis.fetch = mock((input: any) => {
      const url = String(input)
      if (url.endsWith("meta.json")) {
        return Promise.resolve(jsonResponse([upstreamTemplate("alpha")]))
      }
      if (url.endsWith("template.toml")) {
        return Promise.resolve(new Response("[variables]"))
      }
      return Promise.resolve(new Response("services: {}"))
    }) as any

    const res = await get("/templates/alpha")
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.templateToml).toBe("[variables]")
    expect(body.dockerCompose).toBe("services: {}")
  })

  it("builds an absolute logo url so the browser never guesses it", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(jsonResponse([upstreamTemplate("alpha")]))
    ) as any

    const res = await get("/templates")
    const body = (await res.json()) as any
    expect(body.templates[0].logoUrl).toMatch(/\/blueprints\/alpha\/logo\.png$/)
  })

  it("clamps an absurd limit", async () => {
    const catalog = Array.from({ length: 500 }, (_, i) =>
      upstreamTemplate(`tpl-${i}`)
    )
    globalThis.fetch = mock(() => Promise.resolve(jsonResponse(catalog))) as any

    const res = await get("/templates?limit=99999")
    const body = (await res.json()) as any
    expect(body.templates).toHaveLength(100)
  })
})
