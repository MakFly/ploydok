// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono";
import { createHmac, randomBytes } from "node:crypto";
import { createDb } from "@ploydok/db";
import {
  deleteGitHubAppConfig,
  getGitHubAppConfig,
  saveGitHubAppConfig,
} from "@ploydok/db/queries";
import { decryptField, encryptField } from "../github/app-credentials";
import { buildManifest } from "../github/manifest";
import { childLogger } from "../logger";
import { GitHubCache } from "../github/cache";
import { GitHubProvider } from "../github/client";
import { listAppInstallations, revokeAppInstallation } from "../github/installation-tokens";
import { handleWebhook, verifySignature } from "../github/webhook";
import { env } from "../env";

// ---------------------------------------------------------------------------
// Singleton cache + provider (per-process)
// ---------------------------------------------------------------------------

const ghCache = new GitHubCache();
export const ghProvider = new GitHubProvider(ghCache);

const log = childLogger("github.routes");

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const githubRouter = new Hono();

// Database singleton for this router
const db = createDb(env.DATABASE_URL);

// ---------------------------------------------------------------------------
// App-manifest state cookie helpers
// ---------------------------------------------------------------------------

const APP_STATE_COOKIE = "gh_app_state";
const INSTALL_STATE_COOKIE = "gh_install_state";
const APP_STATE_TTL_SECONDS = 10 * 60; // 10 minutes
const SECURE = env.NODE_ENV === "prod";

function signAppState(state: string): string {
  const mac = createHmac("sha256", env.SESSION_SECRET)
    .update(state)
    .digest("hex");
  return `${state}.${mac}`;
}

function verifyAppState(cookieValue: string, state: string): boolean {
  const lastDot = cookieValue.lastIndexOf(".");
  if (lastDot === -1) return false;
  const storedState = cookieValue.slice(0, lastDot);
  const mac = cookieValue.slice(lastDot + 1);
  if (storedState !== state) return false;
  const expected = createHmac("sha256", env.SESSION_SECRET)
    .update(state)
    .digest("hex");
  const expBuf = Buffer.from(expected, "hex");
  const gotBuf = Buffer.from(mac, "hex");
  if (expBuf.length !== gotBuf.length) return false;
  let diff = 0;
  for (let i = 0; i < expBuf.length; i++) diff |= expBuf[i]! ^ gotBuf[i]!;
  return diff === 0;
}

function buildCookieStr(
  name: string,
  value: string,
  maxAge: number,
  httpOnly: boolean,
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "SameSite=Lax",
  ];
  if (httpOnly) parts.push("HttpOnly");
  if (SECURE) parts.push("Secure");
  return parts.join("; ");
}

function clearCookieStr(name: string): string {
  const parts = [`${name}=`, "Path=/", "Max-Age=0", "SameSite=Lax"];
  if (SECURE) parts.push("Secure");
  return parts.join("; ");
}

function parseCookie(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const k = part.slice(0, eqIdx).trim();
    const v = part.slice(eqIdx + 1).trim();
    if (k === name) return decodeURIComponent(v);
  }
  return null;
}

function buildInstallStartUrl(slug: string, state: string): string {
  return `https://github.com/apps/${slug}/installations/new?state=${encodeURIComponent(state)}`;
}

function getApiOrigin(): string {
  return new URL(env.GITHUB_APP_CALLBACK_URL).origin;
}

// ---------------------------------------------------------------------------
// GET /github/repos?page=1&per_page=30&search=  (auth required)
// ---------------------------------------------------------------------------

githubRouter.get("/repos", async (c) => {
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const perPage = Math.min(100, Math.max(1, Number(c.req.query("per_page") ?? 30)));
  const search = c.req.query("search") ?? undefined;

  const config = await getGitHubAppConfig(db);
  if (!config) {
    return c.json({ error: "github_app_not_configured" }, 503);
  }

  let installations;
  try {
    installations = await listAppInstallations();
  } catch (err) {
    log.error({ err }, "listAppInstallations failed");
    return c.json({ error: "github_api_error", detail: String(err) }, 502);
  }

  if (installations.length === 0) {
    return c.json({
      repos: [],
      page,
      perPage,
      hasMore: false,
      needsInstall: true,
      installUrl: `${getApiOrigin()}/github/installations/start`,
    });
  }

  type Repo = Awaited<ReturnType<typeof ghProvider.listRepos>>["repos"][number];

  // Fast path: exact "owner/repo" match → single GET /repos/:owner/:repo (skips
  // full pagination walk, works even if the repo is beyond the first page).
  if (search && search.includes("/")) {
    for (const inst of installations) {
      try {
        const repo = await ghProvider.getRepo(String(inst.id), search);
        return c.json({
          repos: [repo],
          page: 1,
          perPage,
          hasMore: false,
          installUrl: `${getApiOrigin()}/github/installations/start`,
        });
      } catch {
        // not found on this installation, try the next one
      }
    }
    // fall through to full scan (also catches substring matches in fullName)
  }

  // Fetch every page across every installation so users with >100 repos don't
  // see a truncated list (GitHub /installation/repositories returns 100 max per page).
  const MAX_PAGES_PER_INSTALL = 20; // safety cap: 2000 repos/install
  const merged = new Map<string, Repo>();
  for (const inst of installations) {
    for (let p = 1; p <= MAX_PAGES_PER_INSTALL; p++) {
      try {
        const res = await ghProvider.listRepos(String(inst.id), { page: p, perPage: 100 });
        for (const r of res.repos) merged.set(r.fullName, r);
        if (!res.hasMore) break;
      } catch (err) {
        log.warn({ err, installationId: inst.id, page: p }, "listRepos page failed");
        break;
      }
    }
  }

  let all = [...merged.values()];
  if (search) {
    const q = search.toLowerCase();
    all = all.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) ||
        (r.description?.toLowerCase().includes(q) ?? false),
    );
  }

  const start = (page - 1) * perPage;
  const slice = all.slice(start, start + perPage);
  return c.json({
    repos: slice,
    page,
    perPage,
    hasMore: all.length > start + perPage,
    installUrl: `${getApiOrigin()}/github/installations/start`,
  });
});

// ---------------------------------------------------------------------------
// GET /github/repos/:owner/:repo/branches  (auth required)
// ---------------------------------------------------------------------------

githubRouter.get("/repos/:owner/:repo/branches", async (c) => {
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const fullName = `${owner}/${repo}`;

  const config = await getGitHubAppConfig(db);
  if (!config) {
    return c.json({ error: "github_app_not_configured" }, 503);
  }

  const installations = await listAppInstallations().catch(() => []);
  if (installations.length === 0) {
    return c.json({ branches: [] });
  }

  // Prefer the installation whose account matches the repo owner.
  const match = installations.find((i) => i.accountLogin.toLowerCase() === owner.toLowerCase());
  const candidates = match ? [match] : installations;

  for (const inst of candidates) {
    try {
      const branches = await ghProvider.listBranches(String(inst.id), fullName);
      return c.json({ branches });
    } catch (err) {
      log.warn({ err, installationId: inst.id, fullName }, "listBranches failed; trying next");
    }
  }

  return c.json({ error: "repo_not_accessible", detail: fullName }, 404);
});

// ---------------------------------------------------------------------------
// GET /github/installations  (auth required)
// Lists every account/org where the Ploydok GitHub App is installed.
// ---------------------------------------------------------------------------

githubRouter.get("/installations", async (c) => {
  const config = await getGitHubAppConfig(db);
  if (!config) {
    return c.json({ error: "github_app_not_configured" }, 503);
  }

  try {
    const installations = await listAppInstallations();
    // Enrich each with a repository count (best-effort; skip on error).
    const enriched = await Promise.all(
      installations.map(async (inst) => {
        try {
          const { repos } = await ghProvider.listRepos(String(inst.id), { page: 1, perPage: 100 });
          return { ...inst, repositoryCount: repos.length };
        } catch {
          return { ...inst, repositoryCount: null as number | null };
        }
      }),
    );
    return c.json({
      installations: enriched,
      installUrl: `${getApiOrigin()}/github/installations/start`,
    });
  } catch (err) {
    log.error({ err }, "listAppInstallations failed");
    return c.json({ error: "github_api_error", detail: String(err) }, 502);
  }
});

// ---------------------------------------------------------------------------
// GET /github/installations/start  (auth required)
// Creates a signed one-time-ish state cookie, then redirects to GitHub's App
// installation UI. The setup callback validates this state before bouncing
// back to the SPA.
// ---------------------------------------------------------------------------

githubRouter.get("/installations/start", async (c) => {
  const config = await getGitHubAppConfig(db);
  if (!config) {
    return c.json({ error: "github_app_not_configured" }, 503);
  }

  const state = crypto.randomUUID();
  c.header(
    "Set-Cookie",
    buildCookieStr(INSTALL_STATE_COOKIE, signAppState(state), APP_STATE_TTL_SECONDS, true),
  );
  return c.redirect(buildInstallStartUrl(config.slug, state), 302);
});

// ---------------------------------------------------------------------------
// DELETE /github/installations/:id  (auth required)
// Revokes the installation — Ploydok loses access to all repos in that org/user.
// ---------------------------------------------------------------------------

githubRouter.delete("/installations/:id", async (c) => {
  const idParam = c.req.param("id");
  const installationId = Number(idParam);
  if (!Number.isFinite(installationId) || installationId <= 0) {
    return c.json({ error: "invalid_installation_id" }, 400);
  }

  const config = await getGitHubAppConfig(db);
  if (!config) {
    return c.json({ error: "github_app_not_configured" }, 503);
  }

  try {
    await revokeAppInstallation(installationId);
    return c.json({ ok: true, revoked: installationId });
  } catch (err) {
    log.error({ err, installationId }, "revokeAppInstallation failed");
    return c.json({ error: "github_api_error", detail: String(err) }, 502);
  }
});

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
  const installationId = c.req.query("installation_id");
  const setupAction = c.req.query("setup_action");
  const state = c.req.query("state");
  const params = new URLSearchParams();
  if (installationId) params.set("installation_id", installationId);
  if (setupAction) params.set("setup_action", setupAction);
  const cookieHeader = c.req.raw.headers.get("cookie") ?? "";
  const rawInstallStateCookie = parseCookie(cookieHeader, INSTALL_STATE_COOKIE);
  const stateValid =
    !!state &&
    !!rawInstallStateCookie &&
    verifyAppState(rawInstallStateCookie, state);

  c.header("Set-Cookie", clearCookieStr(INSTALL_STATE_COOKIE));
  if (stateValid) params.set("installed", "1");
  else if (state || rawInstallStateCookie) params.set("install_error", "state_mismatch");
  const qs = params.toString();
  return c.redirect(
    `${env.WEB_ORIGIN}/settings/git-providers/github${qs ? `?${qs}` : ""}`,
    302,
  );
});

// [S4.2.A App flow — BEGIN]

// ---------------------------------------------------------------------------
// POST /github/app/manifest  (auth required — wired in app.ts)
// ---------------------------------------------------------------------------

githubRouter.post("/app/manifest", async (c) => {
  const state = crypto.randomUUID();

  // Build self URL (scheme + host from request or env fallback)
  const selfUrl = env.GITHUB_APP_CALLBACK_URL
    ? new URL(env.GITHUB_APP_CALLBACK_URL).origin
    : `http://localhost:${env.PORT}`;

  const manifest = buildManifest({
    webBaseUrl: env.WEB_ORIGIN,
    apiBaseUrl: selfUrl,
  });

  // Store HMAC-signed state in httpOnly cookie (10 min)
  c.header(
    "Set-Cookie",
    buildCookieStr(APP_STATE_COOKIE, signAppState(state), APP_STATE_TTL_SECONDS, true),
  );

  return c.json({
    manifest,
    state,
    post_url: `https://github.com/settings/apps/new?state=${state}`,
  });
});

// ---------------------------------------------------------------------------
// GET /github/app/callback?code=&state=  (public — GitHub redirects here)
// ---------------------------------------------------------------------------

githubRouter.get("/app/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");

  if (!code || !state) {
    return c.json({ error: "missing_code_or_state" }, 400);
  }

  // Verify CSRF state cookie
  const cookieHeader = c.req.raw.headers.get("cookie") ?? "";
  const rawStateCookie = parseCookie(cookieHeader, APP_STATE_COOKIE);
  if (!rawStateCookie) {
    return c.json({ error: "missing_app_state_cookie" }, 400);
  }

  if (!verifyAppState(decodeURIComponent(rawStateCookie), state)) {
    return c.json({ error: "state_mismatch" }, 400);
  }

  // Clear state cookie
  c.header("Set-Cookie", clearCookieStr(APP_STATE_COOKIE));

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
    },
  );

  if (!ghRes.ok) {
    const body = await ghRes.text().catch(() => "");
    return c.json({ error: "github_conversion_failed", detail: body }, 502);
  }

  const data = (await ghRes.json()) as {
    id: number;
    slug: string;
    name: string;
    client_id: string;
    client_secret: string | null;
    pem: string | null;
    // GitHub omits webhook_secret when the manifest has no hook_attributes
    // (loopback dev mode). Treat missing secrets as empty strings — the
    // webhook handler refuses requests when the decrypted secret is empty.
    webhook_secret: string | null;
  };

  const [clientSecretResult, pemResult, webhookSecretResult] = await Promise.all([
    encryptField(data.client_secret ?? ""),
    encryptField(data.pem ?? ""),
    encryptField(data.webhook_secret ?? ""),
  ]);

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
  });

  return c.redirect(`${env.WEB_ORIGIN}/settings/git-providers/github?app=created`, 302);
});

// ---------------------------------------------------------------------------
// GET /github/app/config  (auth required)
// ---------------------------------------------------------------------------

githubRouter.get("/app/config", async (c) => {
  const config = await getGitHubAppConfig(db);
  if (!config) {
    return c.json({ configured: false });
  }
  return c.json({
    configured: true,
    name: config.name,
    slug: config.slug,
    app_id: config.app_id,
    install_url: `${getApiOrigin()}/github/installations/start`,
  });
});

// ---------------------------------------------------------------------------
// DELETE /github/app/config  (auth required — admin reset)
// ---------------------------------------------------------------------------

githubRouter.delete("/app/config", async (c) => {
  await deleteGitHubAppConfig(db);
  return c.json({ ok: true });
});

// [S4.2.A App flow — END]

// [S4.2.B webhook — BEGIN]

// ---------------------------------------------------------------------------
// POST /github/webhook  (public — called by GitHub)
// CSRF is exempted in app.ts because GitHub cannot send the double-submit token.
// Authenticity is verified via HMAC-SHA256 signature on the raw body.
// ---------------------------------------------------------------------------

githubRouter.post("/webhook", async (c) => {
  const config = await getGitHubAppConfig(db);
  if (!config) {
    return c.json({ error: "app not configured" }, 503);
  }

  // Read raw body before any parsing
  const body = await c.req.text();
  const signature = c.req.header("x-hub-signature-256") ?? null;

  // Decrypt webhook secret. Empty string = App was created without a webhook
  // (manifest without hook_attributes, typical of loopback dev setups).
  const webhookSecret = await decryptField(
    config.webhook_secret_enc as Buffer,
    config.webhook_secret_nonce as Buffer,
  );

  if (webhookSecret.length === 0) {
    return c.json({ error: "webhook not configured for this GitHub App" }, 503);
  }

  if (!verifySignature(body, signature, webhookSecret)) {
    log.warn({ signature: signature?.slice(0, 20) }, "webhook signature rejected");
    return c.json({ error: "invalid signature" }, 401);
  }

  const event = c.req.header("x-github-event") ?? "unknown";
  const deliveryId = c.req.header("x-github-delivery") ?? "unknown";

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  // Respond 200 quickly — process async to avoid GitHub timeout (10s)
  queueMicrotask(() =>
    handleWebhook(db, event, payload, deliveryId).catch((err) =>
      log.error({ err, event, deliveryId }, "webhook handler failed"),
    ),
  );

  return c.json({ ok: true });
});

// [S4.2.B webhook — END]

// ---------------------------------------------------------------------------
// Dropped OAuth endpoints (S4.2.B) — 410 Gone stubs
// These routes were served by the Legacy OAuth App flow which is now removed.
// Stubs prevent 404s from old bookmarks / caches in transitional period.
// ---------------------------------------------------------------------------

githubRouter.get("/auth/connect", (c) =>
  c.json({ error: "oauth_removed", message: "Legacy OAuth removed. Use GitHub App." }, 410),
);
githubRouter.get("/auth/callback", (c) =>
  c.json({ error: "oauth_removed", message: "Legacy OAuth removed. Use GitHub App." }, 410),
);
githubRouter.delete("/auth/disconnect", (c) =>
  c.json({ error: "oauth_removed", message: "Legacy OAuth removed. Use GitHub App." }, 410),
);
githubRouter.get("/status", (c) =>
  c.json({ error: "oauth_removed", message: "Legacy OAuth removed. Use GitHub App." }, 410),
);
