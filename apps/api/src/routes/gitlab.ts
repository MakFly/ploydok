// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono"
import { nanoid } from "nanoid"
import { createHash, createHmac, randomBytes } from "node:crypto"
import { createDb } from "@ploydok/db"
import {
  deleteGitLabConfig,
  deleteGitLabTokens,
  getCacheStatus,
  getGitLabConfig,
  getGitLabTokens,
  getInstallationStaleness,
  listInstallations,
  listRepos,
  saveGitLabConfig,
  upsertGitLabTokens,
} from "@ploydok/db/queries"
import { provider_credentials } from "@ploydok/db"
import { enqueueProviderReposSync } from "../worker/handlers/sync-provider-repos"
import { decryptField, encryptField } from "../github/app-credentials"
import { GitLabProvider } from "../gitlab/client"
import { handleGitLabWebhook, verifyGitLabToken } from "../gitlab/webhook"
import { findRecentByPayloadHash, insertDelivery } from "../webhooks/deliveries"
import { gitlabWebhookRateLimit } from "../webhooks/rate-limiters"
import { childLogger } from "../logger"
import { env } from "../env"
import type { AuthUser } from "../auth/middleware"

const log = childLogger("gitlab.routes")

type GitLabRouterEnv = { Variables: { user?: AuthUser } }
export const gitlabRouter = new Hono<GitLabRouterEnv>()

// Per-router DB singleton (same pattern as routes/github.ts).
const db = createDb(env.DATABASE_URL)

function readFileProbeQuery(
  url: string
): { paths: string[]; ref: string } | null {
  const parsed = new URL(url)
  const ref = parsed.searchParams.get("ref")?.trim() ?? ""
  const paths = parsed.searchParams
    .getAll("path")
    .map((path) => path.trim())
    .filter((path) => path.length > 0)

  if (!ref || paths.length === 0 || paths.length > 100) return null
  return { paths: Array.from(new Set(paths)), ref }
}

// ---------------------------------------------------------------------------
// State cookie helpers (OAuth anti-CSRF + redirect-after-connect)
// ---------------------------------------------------------------------------

const OAUTH_STATE_COOKIE = "gl_oauth_state"
const OAUTH_STATE_TTL_SECONDS = 10 * 60
const SECURE = env.NODE_ENV === "prod"

function signState(state: string): string {
  const mac = createHmac("sha256", env.SESSION_SECRET)
    .update(state)
    .digest("hex")
  return `${state}.${mac}`
}

function verifyState(cookieValue: string, state: string): boolean {
  const lastDot = cookieValue.lastIndexOf(".")
  if (lastDot === -1) return false
  const stored = cookieValue.slice(0, lastDot)
  const mac = cookieValue.slice(lastDot + 1)
  if (stored !== state) return false
  const expected = createHmac("sha256", env.SESSION_SECRET)
    .update(state)
    .digest("hex")
  const a = Buffer.from(expected, "hex")
  const b = Buffer.from(mac, "hex")
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

function buildCookie(
  name: string,
  value: string,
  maxAge: number,
  httpOnly: boolean
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "SameSite=Lax",
  ]
  if (httpOnly) parts.push("HttpOnly")
  if (SECURE) parts.push("Secure")
  return parts.join("; ")
}

function clearCookie(name: string): string {
  const parts = [`${name}=`, "Path=/", "Max-Age=0", "SameSite=Lax"]
  if (SECURE) parts.push("Secure")
  return parts.join("; ")
}

function parseCookie(header: string, name: string): string | null {
  for (const part of header.split(";")) {
    const eq = part.indexOf("=")
    if (eq === -1) continue
    const k = part.slice(0, eq).trim()
    const v = part.slice(eq + 1).trim()
    if (k === name) return decodeURIComponent(v)
  }
  return null
}

// ---------------------------------------------------------------------------
// OAuth app config (singleton, admin-managed)
// ---------------------------------------------------------------------------

gitlabRouter.get("/config", async (c) => {
  const cfg = await getGitLabConfig(db)
  if (!cfg) {
    return c.json({ configured: false })
  }
  return c.json({
    configured: true,
    instance_url: cfg.instance_url,
    client_id: cfg.client_id,
  })
})

gitlabRouter.post("/config", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  if (!body) return c.json({ error: "invalid_json" }, 400)

  const instanceUrlRaw =
    (body["instance_url"] as string | undefined) ?? "https://gitlab.com"
  let instanceUrl: URL
  try {
    instanceUrl = new URL(instanceUrlRaw)
  } catch {
    return c.json({ error: "invalid_instance_url" }, 400)
  }
  if (
    instanceUrl.protocol !== "https:" &&
    instanceUrl.hostname !== "localhost" &&
    instanceUrl.hostname !== "127.0.0.1"
  ) {
    return c.json({ error: "insecure_instance_url" }, 400)
  }

  const clientId = (body["client_id"] as string | undefined) ?? ""
  const clientSecret = (body["client_secret"] as string | undefined) ?? ""
  const webhookSecret = (body["webhook_secret"] as string | undefined) ?? ""

  if (!clientId || !clientSecret) {
    return c.json({ error: "missing_credentials" }, 400)
  }

  const cs = await encryptField(clientSecret)
  const ws = await encryptField(webhookSecret)

  await saveGitLabConfig(db, {
    instance_url: instanceUrl.toString().replace(/\/$/, ""),
    client_id: clientId,
    client_secret_enc: cs.enc,
    client_secret_nonce: cs.nonce,
    webhook_secret_enc: ws.enc,
    webhook_secret_nonce: ws.nonce,
  })

  return c.json({ ok: true })
})

gitlabRouter.delete("/config", async (c) => {
  await deleteGitLabConfig(db)
  return c.json({ ok: true })
})

// ---------------------------------------------------------------------------
// OAuth connect: redirect user to GitLab authorize endpoint
// ---------------------------------------------------------------------------

gitlabRouter.get("/connect", async (c) => {
  const user = c.get("user") ?? null
  if (!user) return c.json({ error: "unauthenticated" }, 401)

  const cfg = await getGitLabConfig(db)
  if (!cfg) return c.json({ error: "gitlab_not_configured" }, 503)

  const state = randomBytes(16).toString("hex")
  const authorizeUrl = new URL(`${cfg.instance_url}/oauth/authorize`)
  authorizeUrl.searchParams.set("client_id", cfg.client_id)
  authorizeUrl.searchParams.set("redirect_uri", env.GITLAB_OAUTH_CALLBACK_URL)
  authorizeUrl.searchParams.set("response_type", "code")
  // `api` covers project listing + branches; `read_repository` is sufficient for clone
  // but we need `api` to discover user's projects via /projects?membership=true.
  authorizeUrl.searchParams.set("scope", "api read_repository")
  authorizeUrl.searchParams.set("state", state)

  c.header(
    "Set-Cookie",
    buildCookie(
      OAUTH_STATE_COOKIE,
      signState(state),
      OAUTH_STATE_TTL_SECONDS,
      true
    )
  )
  return c.redirect(authorizeUrl.toString())
})

// ---------------------------------------------------------------------------
// OAuth callback: exchange code for tokens, store encrypted per user
// ---------------------------------------------------------------------------

gitlabRouter.get("/callback", async (c) => {
  const code = c.req.query("code")
  const state = c.req.query("state")
  if (!code || !state) return c.json({ error: "missing_code_or_state" }, 400)

  const cookieVal = parseCookie(
    c.req.header("cookie") ?? "",
    OAUTH_STATE_COOKIE
  )
  if (!cookieVal || !verifyState(cookieVal, state)) {
    return c.json({ error: "invalid_state" }, 400)
  }
  c.header("Set-Cookie", clearCookie(OAUTH_STATE_COOKIE))

  const user = c.get("user") ?? null
  if (!user) return c.json({ error: "unauthenticated" }, 401)

  const cfg = await getGitLabConfig(db)
  if (!cfg) return c.json({ error: "gitlab_not_configured" }, 503)

  const clientSecret = await decryptField(
    cfg.client_secret_enc as Buffer,
    cfg.client_secret_nonce as Buffer
  )

  const tokenUrl = `${cfg.instance_url}/oauth/token`
  const tokenRes = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: cfg.client_id,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: env.GITLAB_OAUTH_CALLBACK_URL,
    }),
  })

  if (!tokenRes.ok) {
    const body = await tokenRes.text()
    log.warn({ status: tokenRes.status, body }, "gitlab token exchange failed")
    return c.json(
      { error: "oauth_exchange_failed", status: tokenRes.status },
      502
    )
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string
    refresh_token?: string
    expires_in?: number
    created_at?: number
  }

  const at = await encryptField(tokens.access_token)
  const rt = tokens.refresh_token
    ? await encryptField(tokens.refresh_token)
    : null
  const expiresAt =
    tokens.expires_in && tokens.created_at
      ? new Date((tokens.created_at + tokens.expires_in) * 1000)
      : tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : null

  await upsertGitLabTokens(db, {
    user_id: user.id,
    access_token_enc: at.enc,
    access_token_nonce: at.nonce,
    refresh_token_enc: rt?.enc ?? null,
    refresh_token_nonce: rt?.nonce ?? null,
    expires_at: expiresAt,
  })

  // Redirect back to the SPA settings page.
  return c.redirect(
    `${env.WEB_ORIGIN}/settings/git-providers/gitlab?connected=1`
  )
})

// ---------------------------------------------------------------------------
// Disconnect: drop stored tokens for this user
// ---------------------------------------------------------------------------

gitlabRouter.delete("/connect", async (c) => {
  const user = c.get("user") ?? null
  if (!user) return c.json({ error: "unauthenticated" }, 401)
  await deleteGitLabTokens(db, user.id)
  return c.json({ ok: true })
})

// ---------------------------------------------------------------------------
// POST /gitlab/installations/sync — manual force-refresh of the cached repos
// for the current user.
// ---------------------------------------------------------------------------

gitlabRouter.post("/installations/sync", async (c) => {
  const user = c.get("user") ?? null
  if (!user) return c.json({ error: "unauthenticated" }, 401)
  const syncId = nanoid()
  const credentialId = `gitlab:user:${user.id}`

  await db
    .insert(provider_credentials)
    .values({
      id: credentialId,
      provider: "gitlab",
      credential_type: "user",
      last_sync_status: "pending",
      last_sync_actor_user_id: user.id,
      last_sync_source: "api",
    })
    .onConflictDoUpdate({
      target: provider_credentials.id,
      set: {
        last_sync_status: "pending",
        last_sync_actor_user_id: user.id,
        last_sync_source: "api",
        updated_at: new Date(),
      },
    })

  await enqueueProviderReposSync({
    provider: "gitlab",
    userId: user.id,
    requestedBy: user.id,
    syncId,
  })
  log.info({ userId: user.id, syncId }, "manual gitlab sync enqueued")
  return c.json({ enqueued: true, syncId }, 202)
})

// ---------------------------------------------------------------------------
// GET /gitlab/installations/cache-status — freshness + repo count for the
// current user's cached installation.
// ---------------------------------------------------------------------------

gitlabRouter.get("/installations/cache-status", async (c) => {
  const user = c.get("user") ?? null
  if (!user) return c.json({ error: "unauthenticated" }, 401)

  const installationId = `gitlab:user:${user.id}`
  const rows = await getCacheStatus(db, "gitlab", installationId)
  const now = Date.now()

  return c.json({
    installation:
      rows[0] != null
        ? {
            id: rows[0].id,
            externalId: rows[0].externalId,
            accountLogin: rows[0].accountLogin,
            avatarUrl: rows[0].avatarUrl,
            htmlUrl: rows[0].htmlUrl,
            lastSyncedAt: rows[0].lastSyncedAt.toISOString(),
            repoCount: rows[0].repoCount,
            ageMs: now - rows[0].lastSyncedAt.getTime(),
            status:
              now - rows[0].lastSyncedAt.getTime() > STALE_THRESHOLD_MS
                ? "stale"
                : "fresh",
          }
        : null,
    staleThresholdMs: STALE_THRESHOLD_MS,
  })
})

// ---------------------------------------------------------------------------
// Repos / branches (per-user OAuth token)
// ---------------------------------------------------------------------------

async function getProviderAndTokenForUser(
  userId: string
): Promise<{ provider: GitLabProvider; accessToken: string } | null> {
  const cfg = await getGitLabConfig(db)
  if (!cfg) return null
  const tokens = await getGitLabTokens(db, userId)
  if (!tokens) return null
  const accessToken = await decryptField(
    tokens.access_token_enc as Buffer,
    tokens.access_token_nonce as Buffer
  )
  return { provider: new GitLabProvider(cfg.instance_url), accessToken }
}

const STALE_THRESHOLD_MS = 10 * 60 * 1000

gitlabRouter.get("/repos", async (c) => {
  const user = c.get("user") ?? null
  if (!user) return c.json({ error: "unauthenticated" }, 401)

  const page = Math.max(1, Number(c.req.query("page") ?? 1))
  const perPage = Math.min(
    100,
    Math.max(1, Number(c.req.query("per_page") ?? 30))
  )
  const search = c.req.query("search") ?? undefined

  const installationId = `gitlab:user:${user.id}`
  const installations = await listInstallations(db, "gitlab")
  const userInstall = installations.find((i) => i.id === installationId)

  if (!userInstall) {
    const credentialId = `gitlab:user:${user.id}`
    db.insert(provider_credentials)
      .values({
        id: credentialId,
        provider: "gitlab",
        credential_type: "user",
        last_sync_status: "pending",
        last_sync_source: "system",
      })
      .onConflictDoUpdate({
        target: provider_credentials.id,
        set: {
          last_sync_status: "pending",
          last_sync_source: "system",
          updated_at: new Date(),
        },
      })
      .catch((err) => log.warn({ err }, "upsert credential failed"))

    enqueueProviderReposSync({ provider: "gitlab", userId: user.id }).catch(
      (err) => {
        log.warn({ err }, "enqueueProviderReposSync failed")
      }
    )
    return c.json({
      repos: [],
      page,
      perPage,
      hasMore: false,
      needsConnect: true,
    })
  }

  const staleness = await getInstallationStaleness(db, "gitlab")
  if (
    staleness.mostStaleAt !== null &&
    Date.now() - staleness.mostStaleAt.getTime() > STALE_THRESHOLD_MS
  ) {
    const credentialId = `gitlab:user:${user.id}`
    db.insert(provider_credentials)
      .values({
        id: credentialId,
        provider: "gitlab",
        credential_type: "user",
        last_sync_status: "pending",
        last_sync_source: "system",
      })
      .onConflictDoUpdate({
        target: provider_credentials.id,
        set: {
          last_sync_status: "pending",
          last_sync_source: "system",
          updated_at: new Date(),
        },
      })
      .catch((err) => log.warn({ err }, "upsert credential failed"))

    enqueueProviderReposSync({ provider: "gitlab", userId: user.id }).catch(
      (err) => {
        log.warn({ err }, "background enqueueProviderReposSync failed")
      }
    )
  }

  const { rows, total } = await listRepos(db, {
    provider: "gitlab",
    ...(search !== undefined && { search }),
    limit: perPage,
    offset: (page - 1) * perPage,
  })

  return c.json({
    repos: rows,
    page,
    perPage,
    hasMore: (page - 1) * perPage + rows.length < total,
  })
})

gitlabRouter.get("/repos/:fullName{.+}/branches", async (c) => {
  const user = c.get("user") ?? null
  if (!user) return c.json({ error: "unauthenticated" }, 401)

  const ctx = await getProviderAndTokenForUser(user.id)
  if (!ctx) return c.json({ error: "gitlab_not_connected" }, 412)

  const fullName = c.req.param("fullName")
  try {
    const branches = await ctx.provider.listBranches(ctx.accessToken, fullName)
    return c.json({ branches })
  } catch (err) {
    log.error({ err, fullName }, "listBranches failed")
    return c.json({ error: "gitlab_api_error" }, 502)
  }
})

gitlabRouter.get("/repos/:fullName{.+}/file-exists", async (c) => {
  const user = c.get("user") ?? null
  if (!user) return c.json({ error: "unauthenticated" }, 401)

  const ctx = await getProviderAndTokenForUser(user.id)
  if (!ctx) return c.json({ error: "gitlab_not_connected" }, 412)

  const fullName = c.req.param("fullName")
  const filePath = c.req.query("path")
  const ref = c.req.query("ref")
  if (!filePath || !ref) {
    return c.json({ error: "missing_path_or_ref" }, 400)
  }

  try {
    const exists = await ctx.provider.fileExists(
      ctx.accessToken,
      fullName,
      filePath,
      ref
    )
    return c.json({ exists })
  } catch (err) {
    log.error({ err, fullName, filePath }, "fileExists failed")
    return c.json({ error: "gitlab_api_error" }, 502)
  }
})

gitlabRouter.get("/repos/:fullName{.+}/files-exist", async (c) => {
  const user = c.get("user") ?? null
  if (!user) return c.json({ error: "unauthenticated" }, 401)

  const ctx = await getProviderAndTokenForUser(user.id)
  if (!ctx) return c.json({ error: "gitlab_not_connected" }, 412)

  const fullName = c.req.param("fullName")
  const query = readFileProbeQuery(c.req.url)
  if (!query) {
    return c.json({ error: "missing_or_invalid_paths_or_ref" }, 400)
  }

  try {
    const entries = await Promise.all(
      query.paths.map(async (filePath) => [
        filePath,
        await ctx.provider.fileExists(
          ctx.accessToken,
          fullName,
          filePath,
          query.ref
        ),
      ] as const)
    )
    return c.json({ files: Object.fromEntries(entries) })
  } catch (err) {
    log.error({ err, fullName }, "filesExist failed")
    return c.json({ error: "gitlab_api_error" }, 502)
  }
})

// ---------------------------------------------------------------------------
// Webhook receiver — GitLab sends `X-Gitlab-Token` header (plain shared secret).
// ---------------------------------------------------------------------------

gitlabRouter.post("/webhook", gitlabWebhookRateLimit, async (c) => {
  const cfg = await getGitLabConfig(db)
  if (!cfg) return c.json({ error: "gitlab_not_configured" }, 503)

  const body = await c.req.text()
  const rawBodyBuffer = Buffer.from(body, "utf-8")
  const token = c.req.header("x-gitlab-token") ?? null
  const event = c.req.header("x-gitlab-event") ?? "unknown"
  const deliveryId = c.req.header("x-gitlab-event-uuid") ?? "unknown"

  // Compute payload hash for dedup and audit (SHA-256 of raw body)
  const payloadHash = createHash("sha256").update(rawBodyBuffer).digest("hex")

  // Dedup: skip if we already processed this exact payload in the last 60s
  const existing = await findRecentByPayloadHash(db, payloadHash)
  if (existing) {
    log.debug({ deliveryId, payloadHash }, "duplicate payload — dedup skip")
    return c.json({ ok: true, dedup: true })
  }

  const expected = await decryptField(
    cfg.webhook_secret_enc as Buffer,
    cfg.webhook_secret_nonce as Buffer
  )
  if (expected.length === 0) {
    return c.json({ error: "webhook_secret_missing" }, 503)
  }
  if (!verifyGitLabToken(token, expected)) {
    log.warn({ event }, "gitlab webhook token rejected")
    // Record invalid token delivery before rejecting
    await insertDelivery(
      db,
      {
        provider: "gitlab",
        delivery_external_id: deliveryId,
        event,
        signature_valid: false,
        decision: "invalid_signature",
        decision_reason: "X-Gitlab-Token mismatch",
        payload_hash: payloadHash,
      },
      rawBodyBuffer
    ).catch((err) =>
      log.warn({ err }, "insertDelivery(invalid_signature) failed")
    )
    return c.json({ error: "invalid_token" }, 401)
  }

  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    return c.json({ error: "invalid_json" }, 400)
  }

  queueMicrotask(() =>
    handleGitLabWebhook(db, event, payload, deliveryId, {
      payloadHash,
      rawBodyBuffer,
    }).catch((err) =>
      log.error({ err, event, deliveryId }, "gitlab webhook handler failed")
    )
  )

  return c.json({ ok: true })
})
