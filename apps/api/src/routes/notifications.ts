// SPDX-License-Identifier: AGPL-3.0-only
import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
import { Hono } from "hono"
import { z } from "zod"
import { and, eq, or, isNull } from "drizzle-orm"
import { nanoid } from "nanoid"
import { notification_channels } from "@ploydok/db"
import { createDb, createRedis } from "@ploydok/db"
import { NotificationConfigSchema, NotificationEventEnum } from "@ploydok/shared"
import type { AuthUser } from "../auth/middleware"
import { requireScope } from "../auth/require-scope"
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

function isAllowedNotificationHost(kind: "discord" | "slack", hostname: string): boolean {
  if (kind === "slack") {
    return hostname === "hooks.slack.com" || hostname === "hooks.slack-gov.com"
  }

  return (
    hostname === "discord.com" ||
    hostname.endsWith(".discord.com") ||
    hostname === "discordapp.com" ||
    hostname.endsWith(".discordapp.com")
  )
}

async function validateNotificationWebhookUrl(
  kind: "discord" | "slack",
  rawUrl: string,
): Promise<string | null> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return "Webhook URL is invalid"
  }

  if (parsed.protocol !== "https:") {
    return "Webhook URL must use https"
  }

  if (parsed.username || parsed.password) {
    return "Webhook URL must not include credentials"
  }

  const hostname = normalizeHostname(parsed.hostname)
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return "Webhook URL points to a blocked local address"
  }

  if (!isAllowedNotificationHost(kind, hostname)) {
    return `Webhook URL host is not allowed for ${kind}`
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

async function validateNotificationConfig(config: Record<string, unknown>): Promise<string | null> {
  if (config.kind === "discord" && typeof config.webhook_url === "string") {
    return validateNotificationWebhookUrl("discord", config.webhook_url)
  }

  if (config.kind === "slack" && typeof config.webhook_url === "string") {
    return validateNotificationWebhookUrl("slack", config.webhook_url)
  }

  return null
}

// ── Router factory ────────────────────────────────────────────────────────────

export function createNotificationsRouter(db: Db): Hono<Env> {
  const router = new Hono<Env>()
  const adminScope = requireScope("admin:*")

  // GET /notifications/channels
  router.get("/channels", adminScope, async (c) => {
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
  router.post("/channels", adminScope, async (c) => {
    const user = c.get("user")
    if (!user) return c.json({ error: "unauthenticated" }, 401)

    const body = await c.req.json().catch(() => null)
    const parsed = CreateChannelBody.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: "invalid_body", details: parsed.error.flatten() }, 400)
    }
    const input = parsed.data

    const configError = await validateNotificationConfig(input.config as Record<string, unknown>)
    if (configError) {
      return c.json({ error: "invalid_body", message: configError }, 400)
    }

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
  router.patch("/channels/:id", adminScope, async (c) => {
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

    if (input.config !== undefined) {
      const configError = await validateNotificationConfig(input.config as Record<string, unknown>)
      if (configError) {
        return c.json({ error: "invalid_body", message: configError }, 400)
      }
    }

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
  router.delete("/channels/:id", adminScope, async (c) => {
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
  router.post("/channels/:id/test", adminScope, async (c) => {
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
    const configError = await validateNotificationConfig(decryptedConfig)
    if (configError) {
      return c.json({ ok: false, error: configError }, 422)
    }

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
