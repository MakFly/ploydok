// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono"
import { nanoid } from "nanoid"
import { createHash, createHmac, randomBytes } from "node:crypto"
import { createDb } from "@ploydok/db"
import {
  deleteGitHubAppConfig,
  getCacheStatus,
  getGitHubAppConfig,
  getInstallationStaleness,
  listInstallations,
  listRepos,
  saveGitHubAppConfig,
} from "@ploydok/db/queries"
import type { ProviderRepoRow } from "@ploydok/db/queries"
import { provider_credentials } from "@ploydok/db"
import { decryptField, encryptField } from "../github/app-credentials"
import { buildManifest } from "../github/manifest"
import { childLogger } from "../logger"
import { GitHubCache } from "../github/cache"
import { GitHubProvider } from "../github/client"
import {
  listAppInstallations,
  revokeAppInstallation,
} from "../github/installation-tokens"
import { handleWebhook, verifySignature } from "../github/webhook"
import { findRecentByPayloadHash, insertDelivery } from "../webhooks/deliveries"
import { githubWebhookRateLimit } from "../webhooks/rate-limiters"
import { enqueueProviderReposSync } from "../worker/handlers/sync-provider-repos"
import { env } from "../env"

// ---------------------------------------------------------------------------
// Singleton cache + provider (per-process)
// ---------------------------------------------------------------------------

const ghCache = new GitHubCache()
export const ghProvider = new GitHubProvider(ghCache)

const log = childLogger("github.routes")

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

type GithubRouterEnv = {
  Variables: { user?: import("../auth/middleware").AuthUser }
}
export const githubRouter = new Hono<GithubRouterEnv>()

// Database singleton for this router
const db = createDb(env.DATABASE_URL)

// ---------------------------------------------------------------------------
// App-manifest state cookie helpers
// ---------------------------------------------------------------------------

const APP_STATE_COOKIE = "gh_app_state"
const INSTALL_STATE_COOKIE = "gh_install_state"
const APP_STATE_TTL_SECONDS = 10 * 60 // 10 minutes
const SECURE = env.NODE_ENV === "prod"

function signAppState(state: string): string {
  const mac = createHmac("sha256", env.SESSION_SECRET)
    .update(state)
    .digest("hex")
  return `${state}.${mac}`
}

function verifyAppState(cookieValue: string, state: string): boolean {
  const lastDot = cookieValue.lastIndexOf(".")
  if (lastDot === -1) return false
  const storedState = cookieValue.slice(0, lastDot)
  const mac = cookieValue.slice(lastDot + 1)
  if (storedState !== state) return false
  const expected = createHmac("sha256", env.SESSION_SECRET)
    .update(state)
    .digest("hex")
  const expBuf = Buffer.from(expected, "hex")
  const gotBuf = Buffer.from(mac, "hex")
  if (expBuf.length !== gotBuf.length) return false
  let diff = 0
  for (let i = 0; i < expBuf.length; i++) diff |= expBuf[i]! ^ gotBuf[i]!
  return diff === 0
}

function buildCookieStr(
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

function clearCookieStr(name: string): string {
  const parts = [`${name}=`, "Path=/", "Max-Age=0", "SameSite=Lax"]
  if (SECURE) parts.push("Secure")
  return parts.join("; ")
}

function parseCookie(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const eqIdx = part.indexOf("=")
    if (eqIdx === -1) continue
    const k = part.slice(0, eqIdx).trim()
    const v = part.slice(eqIdx + 1).trim()
    if (k === name) return decodeURIComponent(v)
  }
  return null
}

function buildInstallStartUrl(slug: string, state: string): string {
  return `https://github.com/apps/${slug}/installations/new?state=${encodeURIComponent(state)}`
}

function getApiOrigin(): string {
  return new URL(env.GITHUB_APP_CALLBACK_URL).origin
}

// ---------------------------------------------------------------------------
// DB → wire format helpers
// ---------------------------------------------------------------------------

function dbRowToWire(row: ProviderRepoRow) {
  return {
    id: row.id,
    fullName: row.full_name,
    description: row.description ?? null,
    private: row.private,
    defaultBranch: row.default_branch ?? "main",
    cloneUrl: row.html_url
      ? row.html_url.replace(/\/?$/, ".git")
      : `https://github.com/${row.full_name}.git`,
  }
}

// ---------------------------------------------------------------------------
// GET /github/repos?page=1&per_page=30&search=  (auth required)
// ---------------------------------------------------------------------------

githubRouter.get("/repos", async (c) => {
  const page = Math.max(1, Number(c.req.query("page") ?? 1))
  const perPage = Math.min(
    100,
    Math.max(1, Number(c.req.query("per_page") ?? 30))
  )
  const search = c.req.query("search") ?? undefined

  const config = await getGitHubAppConfig(db)
  if (!config) {
    return c.json({ error: "github_app_not_configured" }, 503)
  }

  const installUrl = `${getApiOrigin()}/github/installations/start`

  const dbInstallations = await listInstallations(db, "github")

  if (dbInstallations.length === 0) {
    // Fire a background sync so the cache is populated for the next request.
    void enqueueProviderReposSync({ provider: "github" }).catch((err) =>
      log.warn({ err }, "enqueue on empty installations failed")
    )

    // Try a live fetch with a 3s timeout so first-time users don't see an empty list.
    let liveInstallations: Awaited<ReturnType<typeof listAppInstallations>> = []
    try {
      liveInstallations = await Promise.race([
        listAppInstallations(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 3000)
        ),
      ])
    } catch {
      // Timeout or API error — fall through to empty response.
    }

    if (liveInstallations.length === 0) {
      return c.json({
        repos: [],
        page,
        perPage,
        hasMore: false,
        needsInstall: true,
        installUrl,
      })
    }
  }

  // Stale-while-revalidate: if the most stale installation was synced >10 min ago, enqueue.
  const staleness = await getInstallationStaleness(db, "github")
  if (
    staleness.mostStaleAt &&
    Date.now() - staleness.mostStaleAt.getTime() > 10 * 60_000
  ) {
    void enqueueProviderReposSync({ provider: "github" }).catch((err) =>
      log.warn({ err }, "stale-while-revalidate enqueue failed")
    )
  }

  // Fast path: exact "owner/repo" match → try DB first, then live API fallback.
  if (search && search.includes("/")) {
    const dbExact = await listRepos(db, {
      provider: "github",
      search, // narrowed to string by the if-guard above
      limit: 1,
      offset: 0,
    })

    const exactRow = dbExact.rows.find(
      (r) => r.full_name.toLowerCase() === search.toLowerCase()
    )

    if (exactRow) {
      return c.json({
        repos: [dbRowToWire(exactRow)],
        page: 1,
        perPage,
        hasMore: false,
        installUrl,
      })
    }

    // DB miss — try live API per installation.
    const liveInstallations = await listAppInstallations().catch(() => [])
    for (const inst of liveInstallations) {
      try {
        const repo = await ghProvider.getRepo(String(inst.id), search)
        return c.json({
          repos: [repo],
          page: 1,
          perPage,
          hasMore: false,
          installUrl,
        })
      } catch {
        // not found on this installation, try the next one
      }
    }
    // fall through to paginated DB scan
  }

  const offset = (page - 1) * perPage
  const { rows, total } = await listRepos(db, {
    provider: "github",
    ...(search !== undefined ? { search } : {}),
    limit: perPage,
    offset,
  })

  return c.json({
    repos: rows.map(dbRowToWire),
    page,
    perPage,
    hasMore: total > offset + rows.length,
    installUrl,
  })
})

// ---------------------------------------------------------------------------
// POST /github/installations/sync  (auth required)
// Force a full refresh of the repo cache for one or all installations.
// ---------------------------------------------------------------------------

githubRouter.post("/installations/sync", async (c) => {
  const user = c.get("user") ?? null
  let body: { installationId?: string } = {}
  try {
    const raw = await c.req.json().catch(() => ({}))
    if (raw && typeof raw === "object")
      body = raw as { installationId?: string }
  } catch {
    // body is optional — ignore parse errors
  }

  const installationId =
    typeof body.installationId === "string" ? body.installationId : undefined
  const syncId = nanoid()

  if (installationId) {
    const credentialId = `github:${installationId}`
    await db
      .insert(provider_credentials)
      .values({
        id: credentialId,
        provider: "github",
        credential_type: "installation",
        last_sync_status: "pending",
        last_sync_actor_user_id: user?.id ?? null,
        last_sync_source: "api",
      })
      .onConflictDoUpdate({
        target: provider_credentials.id,
        set: {
          last_sync_status: "pending",
          last_sync_actor_user_id: user?.id ?? null,
          last_sync_source: "api",
          updated_at: new Date(),
        },
      })
  }

  await enqueueProviderReposSync({
    provider: "github",
    ...(installationId !== undefined ? { installationId } : {}),
    ...(user ? { requestedBy: user.id } : {}),
    syncId,
  })

  log.info(
    { installationId, syncId, requestedBy: user?.id },
    "manual github sync enqueued"
  )
  return c.json({ enqueued: true, syncId }, 202)
})

// ---------------------------------------------------------------------------
// GET /github/installations/cache-status  (auth required)
// Returns the freshness + cached repo count for every github installation.
// ---------------------------------------------------------------------------

const STALE_THRESHOLD_MS = 10 * 60 * 1000

githubRouter.get("/installations/cache-status", async (c) => {
  const rows = await getCacheStatus(db, "github")
  const now = Date.now()
  return c.json({
    installations: rows.map((r) => ({
      id: r.id,
      externalId: r.externalId,
      accountLogin: r.accountLogin,
      avatarUrl: r.avatarUrl,
      htmlUrl: r.htmlUrl,
      lastSyncedAt: r.lastSyncedAt.toISOString(),
      repoCount: r.repoCount,
      ageMs: now - r.lastSyncedAt.getTime(),
      status:
        now - r.lastSyncedAt.getTime() > STALE_THRESHOLD_MS ? "stale" : "fresh",
    })),
    staleThresholdMs: STALE_THRESHOLD_MS,
  })
})

// ---------------------------------------------------------------------------
// GET /github/repos/:owner/:repo/branches  (auth required)
// ---------------------------------------------------------------------------

githubRouter.get("/repos/:owner/:repo/branches", async (c) => {
  const owner = c.req.param("owner")
  const repo = c.req.param("repo")
  const fullName = `${owner}/${repo}`

  const config = await getGitHubAppConfig(db)
  if (!config) {
    return c.json({ error: "github_app_not_configured" }, 503)
  }

  const installations = await listAppInstallations().catch(() => [])
  if (installations.length === 0) {
    return c.json({ branches: [] })
  }

  // Prefer the installation whose account matches the repo owner.
  const match = installations.find(
    (i) => i.accountLogin.toLowerCase() === owner.toLowerCase()
  )
  const candidates = match ? [match] : installations

  for (const inst of candidates) {
    try {
      const branches = await ghProvider.listBranches(String(inst.id), fullName)
      return c.json({ branches })
    } catch (err) {
      log.warn(
        { err, installationId: inst.id, fullName },
        "listBranches failed; trying next"
      )
    }
  }

  return c.json({ error: "repo_not_accessible", detail: fullName }, 404)
})

// ---------------------------------------------------------------------------
// GET /github/repos/:owner/:repo/file-exists?path=&ref=  (auth required)
// Probes whether a file exists at the given path on the given branch.
// Used by the create-app wizard to auto-detect a Dockerfile.
// ---------------------------------------------------------------------------

githubRouter.get("/repos/:owner/:repo/file-exists", async (c) => {
  const owner = c.req.param("owner")
  const repo = c.req.param("repo")
  const fullName = `${owner}/${repo}`
  const filePath = c.req.query("path")
  const ref = c.req.query("ref")

  if (!filePath || !ref) {
    return c.json({ error: "missing_path_or_ref" }, 400)
  }

  const config = await getGitHubAppConfig(db)
  if (!config) {
    return c.json({ error: "github_app_not_configured" }, 503)
  }

  const installations = await listAppInstallations().catch(() => [])
  if (installations.length === 0) {
    return c.json({ exists: false })
  }

  const match = installations.find(
    (i) => i.accountLogin.toLowerCase() === owner.toLowerCase()
  )
  const candidates = match ? [match] : installations

  for (const inst of candidates) {
    try {
      const exists = await ghProvider.fileExists(
        String(inst.id),
        fullName,
        filePath,
        ref
      )
      return c.json({ exists })
    } catch (err) {
      log.warn(
        { err, installationId: inst.id, fullName, filePath },
        "fileExists failed; trying next"
      )
    }
  }

  return c.json({ error: "repo_not_accessible", detail: fullName }, 404)
})

// ---------------------------------------------------------------------------
// GET /github/installations  (auth required)
// Lists every account/org where the Ploydok GitHub App is installed.
// ---------------------------------------------------------------------------

githubRouter.get("/installations", async (c) => {
  const config = await getGitHubAppConfig(db)
  if (!config) {
    return c.json({ error: "github_app_not_configured" }, 503)
  }

  try {
    const installations = await listAppInstallations()
    // Enrich each with a repository count (best-effort; skip on error).
    const enriched = await Promise.all(
      installations.map(async (inst) => {
        try {
          const { repos } = await ghProvider.listRepos(String(inst.id), {
            page: 1,
            perPage: 100,
          })
          return { ...inst, repositoryCount: repos.length }
        } catch {
          return { ...inst, repositoryCount: null as number | null }
        }
      })
    )
    return c.json({
      installations: enriched,
      installUrl: `${getApiOrigin()}/github/installations/start`,
    })
  } catch (err) {
    log.error({ err }, "listAppInstallations failed")
    return c.json({ error: "github_api_error", detail: String(err) }, 502)
  }
})

// ---------------------------------------------------------------------------
// GET /github/installations/start  (auth required)
// Creates a signed one-time-ish state cookie, then redirects to GitHub's App
// installation UI. The setup callback validates this state before bouncing
// back to the SPA.
// ---------------------------------------------------------------------------

githubRouter.get("/installations/start", async (c) => {
  const config = await getGitHubAppConfig(db)
  if (!config) {
    return c.json({ error: "github_app_not_configured" }, 503)
  }

  const state = crypto.randomUUID()
  c.header(
    "Set-Cookie",
    buildCookieStr(
      INSTALL_STATE_COOKIE,
      signAppState(state),
      APP_STATE_TTL_SECONDS,
      true
    )
  )
  return c.redirect(buildInstallStartUrl(config.slug, state), 302)
})

// ---------------------------------------------------------------------------
// DELETE /github/installations/:id  (auth required)
// Revokes the installation — Ploydok loses access to all repos in that org/user.
// ---------------------------------------------------------------------------

githubRouter.delete("/installations/:id", async (c) => {
  const idParam = c.req.param("id")
  const installationId = Number(idParam)
  if (!Number.isFinite(installationId) || installationId <= 0) {
    return c.json({ error: "invalid_installation_id" }, 400)
  }

  const config = await getGitHubAppConfig(db)
  if (!config) {
    return c.json({ error: "github_app_not_configured" }, 503)
  }

  try {
    await revokeAppInstallation(installationId)
    return c.json({ ok: true, revoked: installationId })
  } catch (err) {
    log.error({ err, installationId }, "revokeAppInstallation failed")
    return c.json({ error: "github_api_error", detail: String(err) }, 502)
  }
})

// ---------------------------------------------------------------------------
// GET /github/app/setup  (public — GitHub redirects here after install/update)
// ---------------------------------------------------------------------------
// GitHub appends `?installation_id=X&setup_action=install|update` when a user
// finishes installing (or updating) the App. We simply forward those params
// to the SPA so it can show a success banner and refetch the installations
// list. Security note: never trust `installation_id` — the UI re-queries
// /github/installations via App JWT to get the authoritative list.
// ---------------------------------------------------------------------------

githubRouter.get("/app/setup", (c) => {
  const installationId = c.req.query("installation_id")
  const setupAction = c.req.query("setup_action")
  const state = c.req.query("state")
  const params = new URLSearchParams()
  if (installationId) params.set("installation_id", installationId)
  if (setupAction) params.set("setup_action", setupAction)
  const cookieHeader = c.req.raw.headers.get("cookie") ?? ""
  const rawInstallStateCookie = parseCookie(cookieHeader, INSTALL_STATE_COOKIE)
  const stateValid =
    !!state &&
    !!rawInstallStateCookie &&
    verifyAppState(rawInstallStateCookie, state)

  c.header("Set-Cookie", clearCookieStr(INSTALL_STATE_COOKIE))
  if (stateValid) params.set("installed", "1")
  else if (state || rawInstallStateCookie)
    params.set("install_error", "state_mismatch")
  const qs = params.toString()
  return c.redirect(
    `${env.WEB_ORIGIN}/settings/git-providers/github${qs ? `?${qs}` : ""}`,
    302
  )
})

// [S4.2.A App flow — BEGIN]

// ---------------------------------------------------------------------------
// POST /github/app/manifest  (auth required — wired in app.ts)
// ---------------------------------------------------------------------------

githubRouter.post("/app/manifest", async (c) => {
  const state = crypto.randomUUID()

  // Build self URL (scheme + host from request or env fallback)
  const selfUrl = env.GITHUB_APP_CALLBACK_URL
    ? new URL(env.GITHUB_APP_CALLBACK_URL).origin
    : `http://localhost:${env.PORT}`

  const manifest = buildManifest({
    webBaseUrl: env.WEB_ORIGIN,
    apiBaseUrl: selfUrl,
  })

  // Store HMAC-signed state in httpOnly cookie (10 min)
  c.header(
    "Set-Cookie",
    buildCookieStr(
      APP_STATE_COOKIE,
      signAppState(state),
      APP_STATE_TTL_SECONDS,
      true
    )
  )

  return c.json({
    manifest,
    state,
    post_url: `https://github.com/settings/apps/new?state=${state}`,
  })
})

// ---------------------------------------------------------------------------
// GET /github/app/callback?code=&state=  (public — GitHub redirects here)
// ---------------------------------------------------------------------------

githubRouter.get("/app/callback", async (c) => {
  const code = c.req.query("code")
  const state = c.req.query("state")

  if (!code || !state) {
    return c.json({ error: "missing_code_or_state" }, 400)
  }

  // Verify CSRF state cookie
  const cookieHeader = c.req.raw.headers.get("cookie") ?? ""
  const rawStateCookie = parseCookie(cookieHeader, APP_STATE_COOKIE)
  if (!rawStateCookie) {
    return c.json({ error: "missing_app_state_cookie" }, 400)
  }

  if (!verifyAppState(decodeURIComponent(rawStateCookie), state)) {
    return c.json({ error: "state_mismatch" }, 400)
  }

  // Clear state cookie
  c.header("Set-Cookie", clearCookieStr(APP_STATE_COOKIE))

  // Exchange code → GitHub App credentials (no auth required)
  const ghRes = await fetch(
    `https://api.github.com/app-manifests/${code}/conversions`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "ploydok",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  )

  if (!ghRes.ok) {
    const body = await ghRes.text().catch(() => "")
    return c.json({ error: "github_conversion_failed", detail: body }, 502)
  }

  const data = (await ghRes.json()) as {
    id: number
    slug: string
    name: string
    client_id: string
    client_secret: string | null
    pem: string | null
    // GitHub omits webhook_secret when the manifest has no hook_attributes
    // (loopback dev mode). Treat missing secrets as empty strings — the
    // webhook handler refuses requests when the decrypted secret is empty.
    webhook_secret: string | null
  }

  const [clientSecretResult, pemResult, webhookSecretResult] =
    await Promise.all([
      encryptField(data.client_secret ?? ""),
      encryptField(data.pem ?? ""),
      encryptField(data.webhook_secret ?? ""),
    ])

  await saveGitHubAppConfig(db, {
    app_id: String(data.id),
    client_id: data.client_id,
    slug: data.slug,
    name: data.name,
    client_secret_enc: clientSecretResult.enc,
    client_secret_nonce: clientSecretResult.nonce,
    pem_enc: pemResult.enc,
    pem_nonce: pemResult.nonce,
    webhook_secret_enc: webhookSecretResult.enc,
    webhook_secret_nonce: webhookSecretResult.nonce,
  })

  return c.redirect(
    `${env.WEB_ORIGIN}/settings/git-providers/github?app=created`,
    302
  )
})

// ---------------------------------------------------------------------------
// GET /github/app/config  (auth required)
// ---------------------------------------------------------------------------

githubRouter.get("/app/config", async (c) => {
  const config = await getGitHubAppConfig(db)
  if (!config) {
    return c.json({ configured: false })
  }
  return c.json({
    configured: true,
    name: config.name,
    slug: config.slug,
    app_id: config.app_id,
    install_url: `${getApiOrigin()}/github/installations/start`,
  })
})

// ---------------------------------------------------------------------------
// DELETE /github/app/config  (auth required — admin reset)
// ---------------------------------------------------------------------------

githubRouter.delete("/app/config", async (c) => {
  await deleteGitHubAppConfig(db)
  return c.json({ ok: true })
})

// [S4.2.A App flow — END]

// [S4.2.B webhook — BEGIN]

// ---------------------------------------------------------------------------
// POST /github/webhook  (public — called by GitHub)
// CSRF is exempted in app.ts because GitHub cannot send the double-submit token.
// Authenticity is verified via HMAC-SHA256 signature on the raw body.
// ---------------------------------------------------------------------------

githubRouter.post("/webhook", githubWebhookRateLimit, async (c) => {
  const config = await getGitHubAppConfig(db)
  if (!config) {
    return c.json({ error: "app not configured" }, 503)
  }

  // Read raw body before any parsing
  const body = await c.req.text()
  const rawBodyBuffer = Buffer.from(body, "utf-8")
  const signature = c.req.header("x-hub-signature-256") ?? null
  const event = c.req.header("x-github-event") ?? "unknown"
  const deliveryId = c.req.header("x-github-delivery") ?? "unknown"

  // Compute payload hash for dedup and audit (SHA-256 of raw body)
  const payloadHash = createHash("sha256").update(rawBodyBuffer).digest("hex")

  // Dedup: if we already processed this exact payload in the last 60s, skip
  const existing = await findRecentByPayloadHash(db, payloadHash)
  if (existing) {
    log.debug({ deliveryId, payloadHash }, "duplicate payload — dedup skip")
    return c.json({ ok: true, dedup: true })
  }

  // Decrypt webhook secret. Empty string = App was created without a webhook
  // (manifest without hook_attributes, typical of loopback dev setups).
  const webhookSecret = await decryptField(
    config.webhook_secret_enc as Buffer,
    config.webhook_secret_nonce as Buffer
  )

  if (webhookSecret.length === 0) {
    return c.json({ error: "webhook not configured for this GitHub App" }, 503)
  }

  if (!verifySignature(body, signature, webhookSecret)) {
    log.warn(
      { signature: signature?.slice(0, 20) },
      "webhook signature rejected"
    )
    // Record invalid signature delivery before rejecting
    await insertDelivery(
      db,
      {
        provider: "github",
        delivery_external_id: deliveryId,
        event,
        signature_valid: false,
        decision: "invalid_signature",
        decision_reason: "HMAC-SHA256 mismatch",
        payload_hash: payloadHash,
      },
      rawBodyBuffer
    ).catch((err) =>
      log.warn({ err }, "insertDelivery(invalid_signature) failed")
    )
    return c.json({ error: "invalid signature" }, 401)
  }

  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    return c.json({ error: "invalid json" }, 400)
  }

  // Respond 200 quickly — process async to avoid GitHub timeout (10s)
  queueMicrotask(() =>
    handleWebhook(
      db,
      event,
      payload,
      deliveryId,
      { payloadHash, rawBodyBuffer },
      { enqueue: enqueueProviderReposSync }
    ).catch((err) =>
      log.error({ err, event, deliveryId }, "webhook handler failed")
    )
  )

  return c.json({ ok: true })
})

// [S4.2.B webhook — END]

// ---------------------------------------------------------------------------
// Dropped OAuth endpoints (S4.2.B) — 410 Gone stubs
// These routes were served by the Legacy OAuth App flow which is now removed.
// Stubs prevent 404s from old bookmarks / caches in transitional period.
// ---------------------------------------------------------------------------

githubRouter.get("/auth/connect", (c) =>
  c.json(
    {
      error: "oauth_removed",
      message: "Legacy OAuth removed. Use GitHub App.",
    },
    410
  )
)
githubRouter.get("/auth/callback", (c) =>
  c.json(
    {
      error: "oauth_removed",
      message: "Legacy OAuth removed. Use GitHub App.",
    },
    410
  )
)
githubRouter.delete("/auth/disconnect", (c) =>
  c.json(
    {
      error: "oauth_removed",
      message: "Legacy OAuth removed. Use GitHub App.",
    },
    410
  )
)
githubRouter.get("/status", (c) =>
  c.json(
    {
      error: "oauth_removed",
      message: "Legacy OAuth removed. Use GitHub App.",
    },
    410
  )
)
