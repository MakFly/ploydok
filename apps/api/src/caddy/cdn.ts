// SPDX-License-Identifier: AGPL-3.0-only
import type { CaddyHandler, CaddyRoute } from "./types.js"

export interface CdnAppConfig {
  cdn_mode: "off" | "internal" | "external"
  cdn_cache_ttl_s: number | null
  cdn_cache_paths: string[] | null
  cdn_compression: boolean | null
  cdn_image_optim: boolean | null
  cdn_headers: string | null
  cdn_external_provider: string | null
}

export interface ApplyCdnOptions {
  staticRoot?: string
}

function parseHeaders(value: string | null): Record<string, string> | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null
    }
    const headers: Record<string, string> = {}
    for (const [name, headerValue] of Object.entries(parsed)) {
      if (typeof headerValue === "string") headers[name] = headerValue
    }
    return Object.keys(headers).length > 0 ? headers : null
  } catch {
    return null
  }
}

function buildHeadersHandler(headers: Record<string, string>): CaddyHandler {
  const set: Record<string, string[]> = {}
  for (const [name, value] of Object.entries(headers)) {
    set[name] = [value]
  }
  return { handler: "headers", response: { set } }
}

function buildCacheHandler(config: CdnAppConfig): CaddyHandler {
  const ttl = config.cdn_cache_ttl_s ?? 300
  return {
    handler: "cache",
    ttl: `${ttl}s`,
    default_cache_control: `public, max-age=${ttl}`,
  }
}

function buildPathScopedCacheHandler(config: CdnAppConfig): CaddyHandler {
  const paths = config.cdn_cache_paths ?? []
  if (paths.length === 0) return buildCacheHandler(config)

  return {
    handler: "subroute",
    routes: [
      {
        match: [{ path: paths }],
        handle: [buildCacheHandler(config)],
      },
    ],
  }
}

function buildImageFilterHandler(root: string): CaddyHandler {
  return {
    handler: "subroute",
    routes: [
      {
        match: [
          {
            path: ["*.jpg", "*.jpeg", "*.png", "*.gif", "*.webp"],
            query: { w: ["*"] },
          },
        ],
        handle: [
          {
            handler: "image_filter",
            root,
            filter_order: ["0000_resize"],
            filters: {
              "0000_resize": {
                width: "{query.w}",
                height: "0",
              },
            },
            max_concurrent: 2,
          },
        ],
      },
    ],
  }
}

export function applyCdnHandlers(
  config: CdnAppConfig,
  route: CaddyRoute,
  opts: ApplyCdnOptions = {}
): CaddyRoute {
  if (config.cdn_mode === "off") return route

  const existing = [...(route.handle ?? [])]
  const reverseProxyIndex = existing.findIndex(
    (handler) =>
      typeof handler === "object" &&
      handler !== null &&
      (handler as { handler?: unknown }).handler === "reverse_proxy"
  )
  const insertAt = reverseProxyIndex === -1 ? 0 : reverseProxyIndex
  const injected: CaddyHandler[] = []

  if (config.cdn_mode === "internal") {
    if (config.cdn_image_optim && opts.staticRoot) {
      injected.push(buildImageFilterHandler(opts.staticRoot))
    }

    if (config.cdn_compression) {
      injected.push({
        handler: "encode",
        encodings: { br: {}, zstd: {}, gzip: {} },
      })
    }

    if ((config.cdn_cache_ttl_s ?? 0) > 0) {
      injected.push(buildPathScopedCacheHandler(config))
    }
  }

  const headers = parseHeaders(config.cdn_headers)
  if (headers) {
    injected.push(buildHeadersHandler(headers))
  }

  if (injected.length === 0) return route

  return {
    ...route,
    handle: [
      ...existing.slice(0, insertAt),
      ...injected,
      ...existing.slice(insertAt),
    ],
  }
}
