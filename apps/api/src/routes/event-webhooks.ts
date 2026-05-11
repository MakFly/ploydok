// SPDX-License-Identifier: AGPL-3.0-only
import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
import { nanoid } from "nanoid"
import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { projects } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { getMembership, isOrgOwner } from "@ploydok/db/queries"
import {
  listEventWebhooks,
  getEventWebhook,
  createEventWebhook,
  updateEventWebhook,
  deleteEventWebhook,
} from "@ploydok/db/queries"
import { encryptField, decryptField } from "../github/app-credentials"
import {
  CreateEventWebhookSchema,
  UpdateEventWebhookSchema,
  WebhookSummarySchema,
} from "@ploydok/shared"
import type { UpdateEventWebhookInput } from "@ploydok/shared"
import type { WebhookPayload } from "@ploydok/shared"
import type { AuthUser } from "../auth/middleware"
import { requireScope } from "../auth/require-scope"

export const WEBHOOK_REDIRECT_ERROR = "Webhook redirects are not allowed"

function getUser(c: { get: (key: string) => unknown }): AuthUser {
  return c.get("user") as AuthUser
}

async function resolveOrgId(
  db: Db,
  slugOrId: string
): Promise<string | null> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slugOrId))
    .limit(1)
  if (rows[0]) return rows[0].id

  const byId = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, slugOrId))
    .limit(1)
  return byId[0]?.id ?? null
}

async function generateSecret(): Promise<string> {
  const bytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "")
}

function isBlockedIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false
  }

  const [a = -1, b = -1] = parts
  if (a === 127) return true
  if (a === 10) return true
  if (a === 169 && b === 254) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  return false
}

function isBlockedIpv6(hostname: string): boolean {
  const lower = hostname.toLowerCase()
  if (lower === "::1" || lower === "::") return true

  if (lower.startsWith("::ffff:")) {
    const mapped = lower.slice("::ffff:".length)
    return isBlockedIpv4(mapped)
  }

  if (lower.startsWith("fc") || lower.startsWith("fd")) return true
  if (lower.startsWith("fe80:")) return true
  return false
}

function isBlockedIpAddress(hostname: string): boolean {
  const version = isIP(hostname)
  if (version === 4) return isBlockedIpv4(hostname)
  if (version === 6) return isBlockedIpv6(hostname)
  return false
}

export async function validateEventWebhookUrl(
  rawUrl: string
): Promise<string | null> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return "Webhook URL is invalid"
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "Webhook URL must use http or https"
  }

  if (parsed.username || parsed.password) {
    return "Webhook URL must not include credentials"
  }

  const hostname = normalizeHostname(parsed.hostname)
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return "Webhook URL points to a blocked local address"
  }

  if (isBlockedIpAddress(hostname)) {
    return "Webhook URL points to a blocked private address"
  }

  if (isIP(hostname) === 0) {
    try {
      const addresses = await lookup(hostname, { all: true, verbatim: true })
      if (
        addresses.length === 0 ||
        addresses.some((address) => isBlockedIpAddress(address.address))
      ) {
        return "Webhook URL resolves to a blocked private address"
      }
    } catch {
      return "Webhook URL host could not be resolved safely"
    }
  }

  return null
}

export async function fetchEventWebhook(
  url: string,
  init: RequestInit
): Promise<Response> {
  const parsed = new URL(url)
  const originalHost = parsed.host
  const hostname = normalizeHostname(parsed.hostname)

  if (isIP(hostname) === 0) {
    const addresses = await lookup(hostname, { all: true, verbatim: true })
    if (
      addresses.length === 0 ||
      addresses.some((address) => isBlockedIpAddress(address.address))
    ) {
      throw new Error("Webhook URL resolves to a blocked private address")
    }

    // WHY: resolve immediately before dispatch and send the request to the
    // chosen IP so a DNS rebinding change between validation and fetch cannot
    // redirect the connection to a private address. The original Host header is
    // preserved for virtual hosts.
    parsed.hostname = addresses[0]!.address
  } else if (isBlockedIpAddress(hostname)) {
    throw new Error("Webhook URL points to a blocked private address")
  }

  const headers = new Headers(init.headers)
  headers.set("Host", originalHost)
  const response = await fetch(parsed.toString(), {
    ...init,
    headers,
    redirect: "manual",
  })
  if (response.status >= 300 && response.status < 400) {
    throw new Error(WEBHOOK_REDIRECT_ERROR)
  }
  return response
}

export function createEventWebhooksRouter(db: Db): Hono {
  const router = new Hono()
  const adminScope = requireScope("admin:*")

  // GET /orgs/:orgId/event-webhooks
  router.get("/:orgId/event-webhooks", adminScope, async (c) => {
    const user = getUser(c)
    const orgParam = c.req.param("orgId")!
    const orgId = await resolveOrgId(db, orgParam)
    if (!orgId) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Organization not found" } },
        404
      )
    }

    const membership = await getMembership(db, orgId, user.id)
    if (!membership) {
      return c.json(
        { error: { code: "FORBIDDEN", message: "Access denied" } },
        403
      )
    }

    const webhooks = await listEventWebhooks(db, orgId)
    const summaries = webhooks.map((w) => ({
      id: w.id,
      name: w.name,
      url: w.url,
      events: w.events,
      enabled: w.enabled,
      last_triggered_at: w.last_triggered_at,
      last_response_status: w.last_response_status,
      last_error: w.last_error,
      created_at: w.created_at,
    }))

    return c.json({ webhooks: summaries })
  })

  // POST /orgs/:orgId/event-webhooks
  router.post("/:orgId/event-webhooks", adminScope, async (c) => {
    const user = getUser(c)
    const orgParam = c.req.param("orgId")!
    const orgId = await resolveOrgId(db, orgParam)
    if (!orgId) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Organization not found" } },
        404
      )
    }

    const isOwner = await isOrgOwner(db, orgId, user.id)
    if (!isOwner) {
      return c.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Only owners can manage event webhooks",
          },
        },
        403
      )
    }

    const body = await c.req.json().catch(() => null)
    const parsed = CreateEventWebhookSchema.safeParse(body)
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid webhook payload",
          },
        },
        400
      )
    }

    const urlError = await validateEventWebhookUrl(parsed.data.url)
    if (urlError) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: urlError,
          },
        },
        400
      )
    }

    let secret = parsed.data.secret
    let secretEncrypted: { enc: Buffer; nonce: Buffer } | null = null

    if (!secret) {
      secret = await generateSecret()
    }

    secretEncrypted = await encryptField(secret)

    const webhook = await createEventWebhook(db, {
      id: nanoid(),
      org_id: orgId,
      name: parsed.data.name,
      url: parsed.data.url,
      events: parsed.data.events,
      secret_enc: secretEncrypted.enc,
      secret_nonce: secretEncrypted.nonce,
      enabled: true,
      created_at: new Date(),
    })

    const summary = {
      id: webhook.id,
      name: webhook.name,
      url: webhook.url,
      events: webhook.events,
      enabled: webhook.enabled,
      last_triggered_at: webhook.last_triggered_at,
      last_response_status: webhook.last_response_status,
      last_error: webhook.last_error,
      created_at: webhook.created_at,
      secret: !parsed.data.secret ? secret : undefined,
    }

    return c.json(summary, 201)
  })

  // PATCH /orgs/:orgId/event-webhooks/:id
  router.patch("/:orgId/event-webhooks/:id", adminScope, async (c) => {
    const user = getUser(c)
    const orgParam = c.req.param("orgId")!
    const orgId = await resolveOrgId(db, orgParam)
    if (!orgId) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Organization not found" } },
        404
      )
    }
    const webhookId = c.req.param("id")!

    const isOwner = await isOrgOwner(db, orgId, user.id)
    if (!isOwner) {
      return c.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Only owners can manage event webhooks",
          },
        },
        403
      )
    }

    const webhook = await getEventWebhook(db, webhookId, orgId)
    if (!webhook) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Webhook not found" } },
        404
      )
    }

    const body = await c.req.json().catch(() => null)
    const parsed = UpdateEventWebhookSchema.safeParse(body)
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid webhook payload",
          },
        },
        400
      )
    }

    if (parsed.data.url !== undefined) {
      const urlError = await validateEventWebhookUrl(parsed.data.url)
      if (urlError) {
        return c.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: urlError,
            },
          },
          400
        )
      }
    }

    const updates: {
      name?: string
      url?: string
      events?: NonNullable<UpdateEventWebhookInput["events"]>
      enabled?: boolean
      secret_enc?: Buffer
      secret_nonce?: Buffer
    } = {}
    if (parsed.data.name !== undefined) updates.name = parsed.data.name
    if (parsed.data.url !== undefined) updates.url = parsed.data.url
    if (parsed.data.events !== undefined) updates.events = parsed.data.events
    if (parsed.data.enabled !== undefined) updates.enabled = parsed.data.enabled

    if (parsed.data.secret !== undefined) {
      const secretEncrypted = await encryptField(parsed.data.secret)
      updates.secret_enc = secretEncrypted.enc
      updates.secret_nonce = secretEncrypted.nonce
    }

    const updated = await updateEventWebhook(db, webhookId, orgId, updates)
    if (!updated) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Webhook not found" } },
        404
      )
    }

    const summary = {
      id: updated.id,
      name: updated.name,
      url: updated.url,
      events: updated.events,
      enabled: updated.enabled,
      last_triggered_at: updated.last_triggered_at,
      last_response_status: updated.last_response_status,
      last_error: updated.last_error,
      created_at: updated.created_at,
    }

    return c.json(summary)
  })

  // DELETE /orgs/:orgId/event-webhooks/:id
  router.delete("/:orgId/event-webhooks/:id", adminScope, async (c) => {
    const user = getUser(c)
    const orgParam = c.req.param("orgId")!
    const orgId = await resolveOrgId(db, orgParam)
    if (!orgId) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Organization not found" } },
        404
      )
    }
    const webhookId = c.req.param("id")!

    const isOwner = await isOrgOwner(db, orgId, user.id)
    if (!isOwner) {
      return c.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Only owners can manage event webhooks",
          },
        },
        403
      )
    }

    const deleted = await deleteEventWebhook(db, webhookId, orgId)
    if (!deleted) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Webhook not found" } },
        404
      )
    }

    return c.json({ success: true })
  })

  // POST /orgs/:orgId/event-webhooks/:id/test
  router.post("/:orgId/event-webhooks/:id/test", adminScope, async (c) => {
    const user = getUser(c)
    const orgParam = c.req.param("orgId")!
    const orgId = await resolveOrgId(db, orgParam)
    if (!orgId) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Organization not found" } },
        404
      )
    }
    const webhookId = c.req.param("id")!

    const membership = await getMembership(db, orgId, user.id)
    if (!membership) {
      return c.json(
        { error: { code: "FORBIDDEN", message: "Access denied" } },
        403
      )
    }

    const webhook = await getEventWebhook(db, webhookId, orgId)
    if (!webhook) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Webhook not found" } },
        404
      )
    }

    const urlError = await validateEventWebhookUrl(webhook.url)
    if (urlError) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: urlError,
          },
        },
        400
      )
    }

    const payload = {
      event: "webhook.test",
      timestamp: new Date().toISOString(),
      org_id: orgId,
      org_slug: "test",
      data: {},
    }

    const body = JSON.stringify(payload)
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Ploydok-Event": "webhook.test",
    }

    if (webhook.secret_enc && webhook.secret_nonce) {
      try {
        const secret = await decryptField(
          webhook.secret_enc,
          webhook.secret_nonce
        )
        const encoder = new TextEncoder()
        const key = await globalThis.crypto.subtle.importKey(
          "raw",
          encoder.encode(secret),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"]
        )
        const signature = await globalThis.crypto.subtle.sign(
          "HMAC",
          key,
          encoder.encode(body)
        )
        const sigHex = Array.from(new Uint8Array(signature))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
        headers["X-Ploydok-Signature"] = `sha256=${sigHex}`
      } catch {
        // Continue without signature
      }
    }

    const startTime = Date.now()
    try {
      const controller = new AbortController()
      const timeoutHandle = setTimeout(() => controller.abort(), 10000)

      const response = await fetchEventWebhook(webhook.url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      })

      clearTimeout(timeoutHandle)
      const latency = Date.now() - startTime

      return c.json({ status: response.status, latency_ms: latency })
    } catch (error) {
      const latency = Date.now() - startTime
      const message = error instanceof Error ? error.message : "Unknown error"
      if (message === WEBHOOK_REDIRECT_ERROR) {
        return c.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message,
            },
          },
          400
        )
      }
      return c.json(
        {
          status: 0,
          latency_ms: latency,
          error: message,
        },
        500
      )
    }
  })

  return router
}
