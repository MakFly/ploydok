// SPDX-License-Identifier: AGPL-3.0-only
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Db } from "@ploydok/db";
import { childLogger } from "../logger";
import { handlePush } from "./webhook-handlers/push";
import { decryptField } from "./app-credentials";

const log = childLogger("webhook");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PushPayload {
  ref: string; // "refs/heads/main"
  after: string; // commit SHA
  repository: {
    full_name: string;
  };
  installation?: {
    id: number;
  };
  head_commit?: {
    message: string;
  } | null;
  commits?: Array<{
    added?: string[];
    modified?: string[];
    removed?: string[];
  }>;
}

export interface WebhookExtras {
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
// Signature verification
// ---------------------------------------------------------------------------

/**
 * Verifies a GitHub webhook signature (X-Hub-Signature-256 header).
 * Uses constant-time comparison to prevent timing attacks.
 */
export function verifySignature(
  body: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const expected =
    "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  // Length must match before timingSafeEqual
  return a.length === b.length && timingSafeEqual(a, b);
}

// PerAppSecretBlobs carries the current and (optional) old encrypted secret for dual-accept.
export interface PerAppSecretBlobs {
  current: Buffer;
  old?: Buffer;
  oldExpiresAt?: Date | null;
}

/**
 * Verifies a GitHub webhook signature using per-app secrets with dual-accept.
 *
 * Strategy:
 *  - If perApp is provided: try current secret first, then old secret (if present and not expired).
 *    If only the old secret passes, log an info event so operators know the provider still uses
 *    the previous secret.
 *  - If perApp is not provided: fall through to the global GitHub App secret (current behavior).
 *
 * Returns { valid: boolean, usedOldSecret: boolean }.
 */
export async function verifySignatureWithFallback(
  body: string,
  signature: string | null,
  globalSecret: string,
  perApp?: PerAppSecretBlobs,
): Promise<{ valid: boolean; usedOldSecret: boolean }> {
  if (!perApp) {
    return { valid: verifySignature(body, signature, globalSecret), usedOldSecret: false };
  }

  // Try current per-app secret
  try {
    const currentPlain = await decryptWebhookSecret(perApp.current);
    if (verifySignature(body, signature, currentPlain)) {
      return { valid: true, usedOldSecret: false };
    }
  } catch (err) {
    log.warn({ err }, "failed to decrypt current per-app webhook secret");
  }

  // Try old per-app secret (if present and not expired)
  if (perApp.old) {
    const now = new Date();
    if (!perApp.oldExpiresAt || perApp.oldExpiresAt > now) {
      try {
        const oldPlain = await decryptWebhookSecret(perApp.old);
        if (verifySignature(body, signature, oldPlain)) {
          log.info("webhook.signature.old_secret_accepted — provider still using previous secret");
          return { valid: true, usedOldSecret: true };
        }
      } catch (err) {
        log.warn({ err }, "failed to decrypt old per-app webhook secret");
      }
    }
  }

  return { valid: false, usedOldSecret: false };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Dispatch a verified GitHub webhook event to the appropriate handler.
 * Called asynchronously after responding 200 to GitHub.
 */
export async function handleWebhook(
  db: Db,
  event: string,
  payload: unknown,
  deliveryId: string,
  extras?: WebhookExtras,
): Promise<void> {
  log.debug({ event, deliveryId }, "dispatching webhook");

  switch (event) {
    case "push":
      await handlePush(db, payload as PushPayload, deliveryId, extras);
      break;

    case "pull_request":
      // Future: trigger preview deployments
      log.debug({ deliveryId }, "pull_request event — no-op");
      break;

    case "installation":
    case "installation_repositories":
      // Future: sync installation → apps binding
      log.info({ event, deliveryId }, "installation lifecycle event — no-op");
      break;

    default:
      log.debug({ event, deliveryId }, "unhandled webhook event");
  }
}
