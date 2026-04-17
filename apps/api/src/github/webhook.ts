// SPDX-License-Identifier: AGPL-3.0-only
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Db } from "@ploydok/db";
import { childLogger } from "../logger";
import { handlePush } from "./webhook-handlers/push";

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
): Promise<void> {
  log.debug({ event, deliveryId }, "dispatching webhook");

  switch (event) {
    case "push":
      await handlePush(db, payload as PushPayload, deliveryId);
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
