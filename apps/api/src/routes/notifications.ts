// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono"
import { z } from "zod"
import { and, eq, or, isNull } from "drizzle-orm"
import { nanoid } from "nanoid"
import { notification_channels } from "@ploydok/db"
import { createDb, createRedis } from "@ploydok/db"
import { NotificationConfigSchema, NotificationEventEnum } from "@ploydok/shared"
import type { AuthUser } from "../auth/middleware"
import { encryptField, decryptField } from "../github/app-credentials"
import { childLogger } from "../logger"
import { env } from "../env"
import { discordAdapter } from "../notify/discord"
import { slackAdapter } from "../notify/slack"
import { telegramAdapter } from "../notify/telegram"
import { whatsappAdapter } from "../notify/whatsapp"
import { emailAdapter } from "../notify/email"
import type { Db } from "@ploydok/db"

const log = childLogger("notifications.routes")

type Env = { Variables: { user?: AuthUser } }

// ── Sensitive fields that must be encrypted per kind ─────────────────────────

const SENSITIVE_FIELDS: Record<string, string[]> = {
  telegram: ["bot_token"],
  whatsapp: ["auth_token"],
}

async function encryptSensitiveFields(config: Record<string, unknown>): Promise<Record<string, unknown>> {
  const kind = config.kind as string
  const fields = SENSITIVE_FIELDS[kind] ?? []
  const result = { ...config }
  for (const field of fields) {
    const value = result[field]
    if (typeof value === "string" && value.length > 0) {
      const { enc, nonce } = await encryptField(value)
      result[field] = `enc:${nonce.toString("base64")}:${enc.toString("base64")}`
    }
  }
  return result
}

async function decryptSensitiveFields(config: Record<string, unknown>): Promise<Record<string, unknown>> {
  const kind = config.kind as string
  const fields = SENSITIVE_FIELDS[kind] ?? []
  const result = { ...config }
  for (const field of fields) {
    const value = result[field]
    if (typeof value === "string" && value.startsWith("enc:")) {
      const parts = value.split(":")
      if (parts.length === 3) {
        const nonce = Buffer.from(parts[1]!, "base64")
        const enc = Buffer.from(parts[2]!, "base64")
        result[field] = await decryptField(enc, nonce)
      }
    }
  }
  return result
}

// ── Validation ────────────────────────────────────────────────────────────────

const CreateChannelBody = z.object({
  name: z.string().min(1).max(128),
  project_id: z.string().nullable().optional(),
  config: NotificationConfigSchema,
  events: z.array(NotificationEventEnum).min(1),
  enabled: z.boolean().optional().default(true),
})

const PatchChannelBody = z.object({
  name: z.string().min(1).max(128).optional(),
  config: NotificationConfigSchema.optional(),
  events: z.array(NotificationEventEnum).min(1).optional(),
  enabled: z.boolean().optional(),
})

// ── Router factory ────────────────────────────────────────────────────────────

export function createNotificationsRouter(db: Db): Hono<Env> {
  const router = new Hono<Env>()

  // GET /notifications/channels
  router.get("/channels", async (c) => {
    const user = c.get("user")
    if (!user) return c.json({ error: "unauthenticated" }, 401)

    const projectId = c.req.query("project_id") ?? null

    const channels = await db
      .select()
      .from(notification_channels)
      .where(
        and(
          eq(notification_channels.owner_id, user.id),
          projectId
            ? or(isNull(notification_channels.project_id), eq(notification_channels.project_id, projectId))
            : undefined,
        ),
      )

    const result = await Promise.all(
      channels.map(async (ch) => ({
        id: ch.id,
        owner_id: ch.owner_id,
        project_id: ch.project_id ?? null,
        kind: ch.kind,
        name: ch.name,
        config: await decryptSensitiveFields(ch.config as Record<string, unknown>),
        events: ch.events,
        enabled: ch.enabled,
        last_error: ch.last_error ?? null,
        last_sent_at: ch.last_sent_at?.toISOString() ?? null,
        created_at: ch.created_at.toISOString(),
      })),
    )

    return c.json({ channels: result })
  })

  // POST /notifications/channels
  router.post("/channels", async (c) => {
    const user = c.get("user")
    if (!user) return c.json({ error: "unauthenticated" }, 401)

    const body = await c.req.json().catch(() => null)
    const parsed = CreateChannelBody.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: "invalid_body", details: parsed.error.flatten() }, 400)
    }
    const input = parsed.data

    const encryptedConfig = await encryptSensitiveFields(input.config as Record<string, unknown>)
    const id = nanoid()

    await db.insert(notification_channels).values({
      id,
      owner_id: user.id,
      project_id: input.project_id ?? null,
      kind: input.config.kind,
      name: input.name,
      config: encryptedConfig,
      events: input.events,
      enabled: input.enabled ?? true,
    })

    log.info({ channelId: id, kind: input.config.kind, userId: user.id }, "notification channel created")
    return c.json({ id }, 201)
  })

  // PATCH /notifications/channels/:id
  router.patch("/channels/:id", async (c) => {
    const user = c.get("user")
    if (!user) return c.json({ error: "unauthenticated" }, 401)

    const channelId = c.req.param("id")!
    const [existing] = await db
      .select()
      .from(notification_channels)
      .where(and(eq(notification_channels.id, channelId), eq(notification_channels.owner_id, user.id)))
      .limit(1)

    if (!existing) return c.json({ error: "not_found" }, 404)

    const body = await c.req.json().catch(() => null)
    const parsed = PatchChannelBody.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: "invalid_body", details: parsed.error.flatten() }, 400)
    }
    const input = parsed.data

    const patch: Partial<typeof notification_channels.$inferInsert> = {}
    if (input.name !== undefined) patch.name = input.name
    if (input.events !== undefined) patch.events = input.events
    if (input.enabled !== undefined) patch.enabled = input.enabled
    if (input.config !== undefined) {
      patch.config = await encryptSensitiveFields(input.config as Record<string, unknown>)
      patch.kind = input.config.kind
    }

    await db
      .update(notification_channels)
      .set(patch)
      .where(eq(notification_channels.id, channelId))

    return c.json({ ok: true })
  })

  // DELETE /notifications/channels/:id
  router.delete("/channels/:id", async (c) => {
    const user = c.get("user")
    if (!user) return c.json({ error: "unauthenticated" }, 401)

    const channelId = c.req.param("id")!
    const deleted = await db
      .delete(notification_channels)
      .where(and(eq(notification_channels.id, channelId), eq(notification_channels.owner_id, user.id)))
      .returning({ id: notification_channels.id })

    if (deleted.length === 0) return c.json({ error: "not_found" }, 404)

    log.info({ channelId, userId: user.id }, "notification channel deleted")
    return c.json({ ok: true })
  })

  // POST /notifications/channels/:id/test — send a canary notification
  router.post("/channels/:id/test", async (c) => {
    const user = c.get("user")
    if (!user) return c.json({ error: "unauthenticated" }, 401)

    const channelId = c.req.param("id")!
    const [ch] = await db
      .select()
      .from(notification_channels)
      .where(and(eq(notification_channels.id, channelId), eq(notification_channels.owner_id, user.id)))
      .limit(1)

    if (!ch) return c.json({ error: "not_found" }, 404)

    const ADAPTERS = { discord: discordAdapter, slack: slackAdapter, telegram: telegramAdapter, whatsapp: whatsappAdapter, email: emailAdapter }
    const adapter = ADAPTERS[ch.kind as keyof typeof ADAPTERS]
    if (!adapter) return c.json({ error: "unsupported_kind" }, 400)

    const decryptedConfig = await decryptSensitiveFields(ch.config as Record<string, unknown>)
    const testChannel = { ...ch, config: decryptedConfig }

    const result = await adapter.send(
      testChannel as typeof ch,
      "build.succeeded",
      { appId: "test", appName: "Test App", commitSha: "abc12345", durationMs: 12345 },
    )

    if (!result.ok) {
      return c.json({ ok: false, error: result.reason }, 422)
    }
    return c.json({ ok: true })
  })

  return router
}

const prodDb = createDb(env.DATABASE_URL)
export const notificationsRouter = createNotificationsRouter(prodDb)
