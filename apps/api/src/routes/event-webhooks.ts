// SPDX-License-Identifier: AGPL-3.0-only
import { nanoid } from "nanoid"
import { Hono } from "hono"
import type { Db } from "@ploydok/db"
import { getMembership } from "@ploydok/db/queries"
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
import type { WebhookPayload } from "@ploydok/shared"
import type { AuthUser } from "../auth/middleware"

function getUser(c: { get: (key: string) => unknown }): AuthUser {
  return c.get("user") as AuthUser
}

async function generateSecret(): Promise<string> {
  const bytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

export function createEventWebhooksRouter(db: Db): Hono {
  const router = new Hono()

  // GET /orgs/:orgId/event-webhooks
  router.get("/:orgId/event-webhooks", async (c) => {
    const user = getUser(c)
    const orgId = c.req.param("orgId")

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
  router.post("/:orgId/event-webhooks", async (c) => {
    const user = getUser(c)
    const orgId = c.req.param("orgId")

    const membership = await getMembership(db, orgId, user.id)
    if (!membership) {
      return c.json(
        { error: { code: "FORBIDDEN", message: "Access denied" } },
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
  router.patch("/:orgId/event-webhooks/:id", async (c) => {
    const user = getUser(c)
    const orgId = c.req.param("orgId")
    const webhookId = c.req.param("id")

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

    const updates: any = {}
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
  router.delete("/:orgId/event-webhooks/:id", async (c) => {
    const user = getUser(c)
    const orgId = c.req.param("orgId")
    const webhookId = c.req.param("id")

    const membership = await getMembership(db, orgId, user.id)
    if (!membership) {
      return c.json(
        { error: { code: "FORBIDDEN", message: "Access denied" } },
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
  router.post("/:orgId/event-webhooks/:id/test", async (c) => {
    const user = getUser(c)
    const orgId = c.req.param("orgId")
    const webhookId = c.req.param("id")

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

      const response = await fetch(webhook.url, {
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
      return c.json(
        {
          status: 0,
          latency_ms: latency,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        500
      )
    }
  })

  return router
}
