// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono"
import type { Context } from "hono"
import type { AuthUser } from "../auth/middleware"
import { getAdminerSession } from "../adminer"

type AppEnv = { Variables: { user?: AuthUser } }

const ADMINER_UPSTREAM = "http://adminer:8080"
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "content-encoding",
  "set-cookie",
])

function getUser(c: { get: (k: string) => unknown }): AuthUser {
  return c.get("user") as AuthUser
}

function publicSessionBase(pathPrefix: string, token: string): string {
  const normalizedPrefix =
    pathPrefix && pathPrefix !== "/" ? pathPrefix.replace(/\/+$/, "") : ""
  return `${normalizedPrefix}/adminer/sessions/${token}`
}

function rewriteLocation(
  value: string | null,
  publicBase: string
): string | null {
  if (!value) return null
  if (value.startsWith(ADMINER_UPSTREAM)) {
    return `${publicBase}${value.slice(ADMINER_UPSTREAM.length)}`
  }
  if (value.startsWith("/")) {
    return `${publicBase}${value}`
  }
  return value
}

function rewriteSetCookie(value: string, publicBase: string): string {
  const withoutDomain = value.replace(/;\s*Domain=[^;]*/gi, "")
  if (/;\s*Path=/i.test(withoutDomain)) {
    return withoutDomain.replace(/;\s*Path=[^;]*/i, `; Path=${publicBase}`)
  }
  return `${withoutDomain}; Path=${publicBase}`
}

function upstreamCookie(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined
  const allowed: Array<string> = []
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim()
    if (
      trimmed.startsWith("ploydok_adminer=") ||
      trimmed.startsWith("adminer_")
    ) {
      allowed.push(trimmed)
    }
  }
  return allowed.length > 0 ? allowed.join("; ") : undefined
}

function appendResponseHeaders(
  target: Headers,
  source: Headers,
  publicBase: string
): void {
  source.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (lower === "location") {
      const rewritten = rewriteLocation(value, publicBase)
      if (rewritten) target.set("location", rewritten)
      return
    }
    if (HOP_BY_HOP_HEADERS.has(lower)) return
    target.set(key, value)
  })

  const getSetCookie = (
    source as Headers & { getSetCookie?: () => Array<string> }
  ).getSetCookie
  const setCookies =
    typeof getSetCookie === "function"
      ? getSetCookie.call(source)
      : source.get("set-cookie")
        ? [source.get("set-cookie") as string]
        : []

  for (const cookie of setCookies) {
    target.append("set-cookie", rewriteSetCookie(cookie, publicBase))
  }
}

export function createAdminerRouter(): Hono<AppEnv> {
  const router = new Hono<AppEnv>()

  async function handleProxy(c: Context<AppEnv>) {
    const user = getUser(c)
    const token = c.req.param("sessionId")
    if (!token) {
      return c.json(
        {
          error: {
            code: "ADMINER_SESSION_REQUIRED",
            message: "Adminer session token is required",
          },
        },
        400
      )
    }
    const session = await getAdminerSession(token, user.id)
    if (!session) {
      return c.json(
        {
          error: {
            code: "ADMINER_SESSION_EXPIRED",
            message: "Adminer session expired",
          },
        },
        401
      )
    }

    const tail = c.req.param("*") ?? ""
    const upstreamPath = `/${tail}`.replace(/\/+$/, "") || "/"
    const requestUrl = new URL(c.req.url)
    const upstreamUrl = `${ADMINER_UPSTREAM}${upstreamPath}${requestUrl.search}`
    const publicBase = publicSessionBase(
      c.req.header("x-forwarded-prefix") ?? "",
      token
    )
    const headers = new Headers()
    headers.set("x-ploydok-adminer-driver", session.driver)
    headers.set("x-ploydok-adminer-server", session.server)
    headers.set("x-ploydok-adminer-database", session.database)
    headers.set("x-ploydok-adminer-username", session.username)
    headers.set("x-forwarded-host", c.req.header("host") ?? "")
    headers.set(
      "x-forwarded-proto",
      c.req.header("x-forwarded-proto") ?? "http"
    )
    const cookie = upstreamCookie(c.req.header("cookie") ?? null)
    if (cookie) headers.set("cookie", cookie)
    const contentType = c.req.header("content-type")
    if (contentType) headers.set("content-type", contentType)

    const method = c.req.method
    const body =
      method === "GET" || method === "HEAD"
        ? undefined
        : await c.req.arrayBuffer()

    const upstream = await fetch(upstreamUrl, {
      method,
      headers,
      body,
      redirect: "manual",
    })

    const responseHeaders = new Headers()
    appendResponseHeaders(responseHeaders, upstream.headers, publicBase)
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    })
  }

  router.all("/sessions/:sessionId", handleProxy)
  router.all("/sessions/:sessionId/*", handleProxy)

  return router
}
