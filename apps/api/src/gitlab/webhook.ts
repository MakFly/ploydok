// SPDX-License-Identifier: AGPL-3.0-only
import { timingSafeEqual } from "node:crypto";
import type { Db } from "@ploydok/db";
import type { ParsedPushEvent } from "@ploydok/shared";
import { childLogger } from "../logger";
import { handlePushGeneric } from "../webhook-handlers/push";

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
  }>;
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

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export async function handleGitLabWebhook(
  db: Db,
  event: string,
  payload: unknown,
  deliveryId: string,
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

  const parsed: ParsedPushEvent = {
    provider: "gitlab",
    repoFullName: push.project.path_with_namespace,
    branch: push.ref.replace(/^refs\/heads\//, ""),
    commitSha: push.checkout_sha,
    commitMessage: push.commits?.[0]?.message ?? "",
    // GitLab webhook identifies user via numeric user_id. The deploy worker
    // loads matching apps' OAuth tokens by user_id when cloning.
    authRef: String(push.user_id),
  };

  await handlePushGeneric(db, parsed, deliveryId);
}
