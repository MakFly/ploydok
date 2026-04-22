// SPDX-License-Identifier: AGPL-3.0-only
import { timingSafeEqual } from "node:crypto";
import type { Db } from "@ploydok/db";
import type { ParsedPushEvent } from "@ploydok/shared";
import { childLogger } from "../logger";
import { handlePushGeneric } from "../webhook-handlers/push";
import { decryptField } from "../github/app-credentials";

const log = childLogger("gitlab.webhook");

// ---------------------------------------------------------------------------
// Payload shape (subset) — GitLab "Push Hook" event
// ---------------------------------------------------------------------------

export interface GitLabPushPayload {
  object_kind: string;          // "push"
  event_name: string;           // "push"
  ref: string;                  // "refs/heads/main"
  checkout_sha: string;
  user_id: number;
  project: {
    id: number;
    path_with_namespace: string;
  };
  commits?: Array<{
    id: string;
    message: string;
    added?: string[];
    modified?: string[];
    removed?: string[];
  }>;
}

export interface GitLabWebhookExtras {
  payloadHash?: string;
  rawBodyBuffer?: Buffer;
}

// ---------------------------------------------------------------------------
// Encryption helpers for per-app webhook secrets (nonce || enc layout)
// ---------------------------------------------------------------------------

// Per-app secrets are stored as nonce (12 bytes) || AES-GCM ciphertext in bytea.
async function decryptWebhookSecret(blob: Buffer): Promise<string> {
  const nonce = blob.subarray(0, 12);
  const enc = blob.subarray(12);
  return decryptField(enc, nonce);
}

// ---------------------------------------------------------------------------
// Token verification
//
// GitLab webhooks carry a plain shared secret in the `X-Gitlab-Token` header
// (no HMAC). The secret is constant-time compared with the stored value.
// ---------------------------------------------------------------------------

export function verifyGitLabToken(
  receivedHeader: string | null,
  expectedSecret: string,
): boolean {
  if (!receivedHeader || !expectedSecret) return false;
  const a = Buffer.from(receivedHeader);
  const b = Buffer.from(expectedSecret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface PerAppTokenBlobs {
  current: Buffer;
  old?: Buffer;
  oldExpiresAt?: Date | null;
}

/**
 * Verifies a GitLab webhook token with dual-accept for per-app secrets.
 *
 * Strategy:
 *  - If perApp is provided: try current secret, then old secret (if present and not expired).
 *  - If perApp is not provided: fall through to the global GitLab config secret.
 *
 * Returns { valid: boolean, usedOldSecret: boolean }.
 */
export async function verifyGitLabTokenWithFallback(
  receivedHeader: string | null,
  globalSecret: string,
  perApp?: PerAppTokenBlobs,
): Promise<{ valid: boolean; usedOldSecret: boolean }> {
  if (!perApp) {
    return { valid: verifyGitLabToken(receivedHeader, globalSecret), usedOldSecret: false };
  }

  // Try current per-app secret
  try {
    const currentPlain = await decryptWebhookSecret(perApp.current);
    if (verifyGitLabToken(receivedHeader, currentPlain)) {
      return { valid: true, usedOldSecret: false };
    }
  } catch (err) {
    log.warn({ err }, "failed to decrypt current per-app gitlab webhook secret");
  }

  // Try old per-app secret (if present and not expired)
  if (perApp.old) {
    const now = new Date();
    if (!perApp.oldExpiresAt || perApp.oldExpiresAt > now) {
      try {
        const oldPlain = await decryptWebhookSecret(perApp.old);
        if (verifyGitLabToken(receivedHeader, oldPlain)) {
          log.info("webhook.signature.old_secret_accepted (gitlab) — provider still using previous secret");
          return { valid: true, usedOldSecret: true };
        }
      } catch (err) {
        log.warn({ err }, "failed to decrypt old per-app gitlab webhook secret");
      }
    }
  }

  return { valid: false, usedOldSecret: false };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export async function handleGitLabWebhook(
  db: Db,
  event: string,
  payload: unknown,
  deliveryId: string,
  extras?: GitLabWebhookExtras,
): Promise<void> {
  log.debug({ event, deliveryId }, "dispatching gitlab webhook");

  if (event !== "Push Hook") {
    log.debug({ event, deliveryId }, "unhandled gitlab event");
    return;
  }

  const push = payload as GitLabPushPayload;
  if (push.object_kind !== "push") {
    log.warn({ event, deliveryId }, "event header/body mismatch");
    return;
  }

  // Collect changed files from all commits
  const changedFiles: string[] = [];
  for (const commit of push.commits ?? []) {
    for (const f of commit.added ?? []) changedFiles.push(f);
    for (const f of commit.modified ?? []) changedFiles.push(f);
    for (const f of commit.removed ?? []) changedFiles.push(f);
  }

  const parsed: Parameters<typeof handlePushGeneric>[1] = {
    provider: "gitlab",
    repoFullName: push.project.path_with_namespace,
    ref: push.ref,
    branch: push.ref.replace(/^refs\/heads\//, ""),
    commitSha: push.checkout_sha,
    commitMessage: push.commits?.[0]?.message ?? "",
    // GitLab webhook identifies user via numeric user_id. The deploy worker
    // loads matching apps' OAuth tokens by user_id when cloning.
    authRef: String(push.user_id),
  };
  if (changedFiles.length > 0) parsed.changedFiles = changedFiles;
  if (extras?.payloadHash) parsed.payloadHash = extras.payloadHash;
  if (extras?.rawBodyBuffer) parsed.rawBody = extras.rawBodyBuffer;

  await handlePushGeneric(db, parsed, deliveryId);
}
