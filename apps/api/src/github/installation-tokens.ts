// SPDX-License-Identifier: AGPL-3.0-only
import { signAppJwt } from "./jwt";
import { decryptField } from "./app-credentials";
import { getGitHubAppConfig } from "@ploydok/db/queries";
import { createDb } from "@ploydok/db";
import { env } from "../env";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}

// ---------------------------------------------------------------------------
// In-memory token cache (per-process, 50-minute window)
// GitHub installation tokens expire after 1 hour; we cache for 50 min.
// ---------------------------------------------------------------------------

const TOKEN_CACHE = new Map<string, CachedToken>();
const CACHE_TTL_MS = 50 * 60 * 1000; // 50 minutes

// ---------------------------------------------------------------------------
// DB singleton
// ---------------------------------------------------------------------------

const db = createDb(env.DATABASE_URL);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns a valid GitHub installation access token for the given installation.
 * Tokens are cached in-process for 50 minutes; GitHub grants 1 hour.
 */
export async function getInstallationToken(installationId: string): Promise<string> {
  const cached = TOKEN_CACHE.get(installationId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.token;
  }

  // Load GitHub App config from DB
  const config = await getGitHubAppConfig(db);
  if (!config) {
    throw new Error("GitHub App not configured — run the App manifest flow first");
  }

  // Decrypt the PEM private key
  const pem = await decryptField(config.pem_enc as Buffer, config.pem_nonce as Buffer);

  // Sign a short-lived JWT for the App itself
  const jwt = signAppJwt(pem, config.app_id);

  // Exchange for an installation access token
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "User-Agent": "ploydok",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `GitHub installation token request failed: ${res.status} ${body}`,
    );
  }

  const data = (await res.json()) as { token: string; expires_at: string };
  const token = data.token;

  // Cache with 50-minute TTL regardless of actual expiry
  TOKEN_CACHE.set(installationId, {
    token,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return token;
}

/**
 * Evict a specific installation token from the cache (e.g. on revocation).
 */
export function evictInstallationToken(installationId: string): void {
  TOKEN_CACHE.delete(installationId);
}

export interface AppInstallation {
  id: number;
  accountLogin: string;
  accountType: string;
  repositorySelection: "all" | "selected";
  suspendedAt: string | null;
  htmlUrl: string;
  avatarUrl: string;
}

/**
 * List all installations of the configured GitHub App.
 * Authenticates with a short-lived App JWT (signed with the App private key).
 */
export async function listAppInstallations(): Promise<AppInstallation[]> {
  const config = await getGitHubAppConfig(db);
  if (!config) {
    throw new Error("GitHub App not configured");
  }

  const pem = await decryptField(config.pem_enc as Buffer, config.pem_nonce as Buffer);
  const jwt = signAppJwt(pem, config.app_id);

  const res = await fetch("https://api.github.com/app/installations?per_page=100", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${jwt}`,
      "User-Agent": "ploydok",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub /app/installations returned ${res.status}: ${body}`);
  }

  const data = (await res.json()) as Array<{
    id: number;
    account: { login?: string; type?: string; html_url?: string; avatar_url?: string } | null;
    repository_selection?: "all" | "selected";
    suspended_at?: string | null;
    html_url?: string;
  }>;

  return data.map((i) => ({
    id: i.id,
    accountLogin: i.account?.login ?? "",
    accountType: i.account?.type ?? "",
    repositorySelection: i.repository_selection ?? "selected",
    suspendedAt: i.suspended_at ?? null,
    htmlUrl: i.html_url ?? i.account?.html_url ?? "",
    avatarUrl: i.account?.avatar_url ?? "",
  }));
}

/**
 * Delete/revoke an installation by id. The App loses access to all repos
 * granted by that installation. The owner can re-install anytime.
 */
export async function revokeAppInstallation(installationId: number): Promise<void> {
  const config = await getGitHubAppConfig(db);
  if (!config) {
    throw new Error("GitHub App not configured");
  }

  const pem = await decryptField(config.pem_enc as Buffer, config.pem_nonce as Buffer);
  const jwt = signAppJwt(pem, config.app_id);

  const res = await fetch(`https://api.github.com/app/installations/${installationId}`, {
    method: "DELETE",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${jwt}`,
      "User-Agent": "ploydok",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub DELETE /app/installations/${installationId} returned ${res.status}: ${body}`);
  }

  evictInstallationToken(String(installationId));
}
