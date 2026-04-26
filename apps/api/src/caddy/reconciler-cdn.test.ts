// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from "bun:test"
import { applyCdnHandlers, type CdnAppConfig } from "./reconciler.js"
import type { CaddyRoute, CaddyHandler } from "./types.js"

function createTestRoute(): CaddyRoute {
  return {
    "@id": "test-route",
    match: [{ host: ["example.test.local"] }],
    handle: [
      {
        handler: "rate_limit",
        rate_limits: {
          default: {
            key: "{http.request.remote_ip}",
            window: "1s",
            max_events: 10,
          },
        },
      },
      {
        handler: "reverse_proxy",
        upstreams: [{ dial: "ploydok-app-test:3000" }],
      },
    ],
    terminal: true,
  }
}

describe("applyCdnHandlers", () => {
  test("mode off returns route unchanged", () => {
    const config: CdnAppConfig = {
      cdn_mode: "off",
      cdn_cache_ttl_s: 300,
      cdn_cache_paths: [],
      cdn_compression: false,
      cdn_image_optim: false,
      cdn_headers: null,
      cdn_external_provider: null,
    }

    const route = createTestRoute()
    const result = applyCdnHandlers(config, route)

    expect(result).toEqual(route)
  })

  test("internal mode adds cache handler before reverse_proxy", () => {
    const config: CdnAppConfig = {
      cdn_mode: "internal",
      cdn_cache_ttl_s: 300,
      cdn_cache_paths: [],
      cdn_compression: false,
      cdn_image_optim: false,
      cdn_headers: null,
      cdn_external_provider: null,
    }

    const route = createTestRoute()
    const result = applyCdnHandlers(config, route)

    const handlers = result.handle as Array<Record<string, unknown>>
    const cacheIndex = handlers.findIndex((h) => h.handler === "cache")
    const reverseProxyIndex = handlers.findIndex(
      (h) => h.handler === "reverse_proxy"
    )

    expect(cacheIndex).toBeGreaterThan(-1)
    expect(reverseProxyIndex).toBeGreaterThan(-1)
    expect(cacheIndex).toBeLessThan(reverseProxyIndex)
  })

  test("compression adds encode handler", () => {
    const config: CdnAppConfig = {
      cdn_mode: "internal",
      cdn_cache_ttl_s: 300,
      cdn_cache_paths: [],
      cdn_compression: true,
      cdn_image_optim: false,
      cdn_headers: null,
      cdn_external_provider: null,
    }

    const route = createTestRoute()
    const result = applyCdnHandlers(config, route)

    const handlers = result.handle as Array<Record<string, unknown>>
    const encodeHandler = handlers.find((h) => h.handler === "encode")
    expect(encodeHandler).toBeDefined()
    expect(encodeHandler?.encodings).toEqual({ gzip: {} })
  })

  test("image_optim adds image_optim handler", () => {
    const config: CdnAppConfig = {
      cdn_mode: "internal",
      cdn_cache_ttl_s: 300,
      cdn_cache_paths: [],
      cdn_compression: false,
      cdn_image_optim: true,
      cdn_headers: null,
      cdn_external_provider: null,
    }

    const route = createTestRoute()
    const result = applyCdnHandlers(config, route)

    const handlers = result.handle as Array<Record<string, unknown>>
    const imageOptimHandler = handlers.find((h) => h.handler === "image_optim")
    expect(imageOptimHandler).toBeDefined()
  })

  test("image_optim + compression adds both with proper order", () => {
    const config: CdnAppConfig = {
      cdn_mode: "internal",
      cdn_cache_ttl_s: 300,
      cdn_cache_paths: [],
      cdn_compression: true,
      cdn_image_optim: true,
      cdn_headers: null,
      cdn_external_provider: null,
    }

    const route = createTestRoute()
    const result = applyCdnHandlers(config, route)

    const handlers = result.handle as Array<Record<string, unknown>>
    const imageOptimIndex = handlers.findIndex(
      (h) => h.handler === "image_optim"
    )
    const encodeIndex = handlers.findIndex((h) => h.handler === "encode")

    expect(imageOptimIndex).toBeGreaterThan(-1)
    expect(encodeIndex).toBeGreaterThan(-1)
    expect(imageOptimIndex).toBeLessThan(encodeIndex)
  })

  test("headers are added for internal mode", () => {
    const config: CdnAppConfig = {
      cdn_mode: "internal",
      cdn_cache_ttl_s: 300,
      cdn_cache_paths: [],
      cdn_compression: false,
      cdn_image_optim: false,
      cdn_headers: '{"X-Custom": "value", "Cache-Control": "public"}',
      cdn_external_provider: null,
    }

    const route = createTestRoute()
    const result = applyCdnHandlers(config, route)

    const handlers = result.handle as Array<Record<string, unknown>>
    const headersHandler = handlers.find((h) => h.handler === "headers")
    expect(headersHandler).toBeDefined()
    expect(headersHandler?.request).toEqual({
      set: { "X-Custom": "value", "Cache-Control": "public" },
    })
  })

  test("invalid headers JSON is silently ignored", () => {
    const config: CdnAppConfig = {
      cdn_mode: "internal",
      cdn_cache_ttl_s: 300,
      cdn_cache_paths: [],
      cdn_compression: false,
      cdn_image_optim: false,
      cdn_headers: "{invalid json",
      cdn_external_provider: null,
    }

    const route = createTestRoute()
    const result = applyCdnHandlers(config, route)

    const handlers = result.handle as Array<Record<string, unknown>>
    const headersHandler = handlers.find((h) => h.handler === "headers")
    expect(headersHandler).toBeUndefined()
  })

  test("external mode ignores cache handlers", () => {
    const config: CdnAppConfig = {
      cdn_mode: "external",
      cdn_cache_ttl_s: 300,
      cdn_cache_paths: [],
      cdn_compression: false,
      cdn_image_optim: false,
      cdn_headers: null,
      cdn_external_provider: "cloudflare",
    }

    const route = createTestRoute()
    const result = applyCdnHandlers(config, route)

    expect(result).toEqual(route)
  })

  test("cache_ttl_s=0 disables caching", () => {
    const config: CdnAppConfig = {
      cdn_mode: "internal",
      cdn_cache_ttl_s: 0,
      cdn_cache_paths: [],
      cdn_compression: false,
      cdn_image_optim: false,
      cdn_headers: null,
      cdn_external_provider: null,
    }

    const route = createTestRoute()
    const result = applyCdnHandlers(config, route)

    const handlers = result.handle as Array<Record<string, unknown>>
    const cacheHandler = handlers.find((h) => h.handler === "cache")
    expect(cacheHandler).toBeUndefined()
  })

  test("preserves middleware order (rate_limit before cache)", () => {
    const config: CdnAppConfig = {
      cdn_mode: "internal",
      cdn_cache_ttl_s: 300,
      cdn_cache_paths: [],
      cdn_compression: false,
      cdn_image_optim: false,
      cdn_headers: null,
      cdn_external_provider: null,
    }

    const route = createTestRoute()
    const result = applyCdnHandlers(config, route)

    const handlers = result.handle as Array<Record<string, unknown>>
    const rateLimitIndex = handlers.findIndex((h) => h.handler === "rate_limit")
    const cacheIndex = handlers.findIndex((h) => h.handler === "cache")

    expect(rateLimitIndex).toBeLessThan(cacheIndex)
  })
})
