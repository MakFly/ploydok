// SPDX-License-Identifier: AGPL-3.0-only
import type { Db } from "@ploydok/db";
import type { PushPayload, WebhookExtras } from "../webhook";
import { handlePushGeneric } from "../../webhook-handlers/push";

/**
 * GitHub-specific push handler — normalises the GitHub webhook payload into
 * a provider-agnostic `ParsedPushEvent`, then delegates to the generic handler.
 */
export async function handlePush(
  db: Db,
  payload: PushPayload,
  deliveryId: string,
  extras?: WebhookExtras,
): Promise<void> {
  // Collect changed files from all commits in this push
  const changedFiles: string[] = [];
  for (const commit of payload.commits ?? []) {
    for (const f of commit.added ?? []) changedFiles.push(f);
    for (const f of commit.modified ?? []) changedFiles.push(f);
    for (const f of commit.removed ?? []) changedFiles.push(f);
  }

  const parsed: Parameters<typeof handlePushGeneric>[1] = {
    provider: "github",
    repoFullName: payload.repository.full_name,
    ref: payload.ref,
    branch: payload.ref.replace(/^refs\/heads\//, ""),
    commitSha: payload.after,
    commitMessage: payload.head_commit?.message ?? "",
    authRef: String(payload.installation?.id ?? ""),
  };
  if (changedFiles.length > 0) parsed.changedFiles = changedFiles;
  if (extras?.payloadHash) parsed.payloadHash = extras.payloadHash;
  if (extras?.rawBodyBuffer) parsed.rawBody = extras.rawBodyBuffer;

  await handlePushGeneric(db, parsed, deliveryId);
}
