// SPDX-License-Identifier: AGPL-3.0-only
import type { Db } from "@ploydok/db";
import type { PushPayload } from "../webhook";
import { handlePushGeneric } from "../../webhook-handlers/push";

/**
 * GitHub-specific push handler — normalises the GitHub webhook payload into
 * a provider-agnostic `ParsedPushEvent`, then delegates to the generic handler.
 */
export async function handlePush(
  db: Db,
  payload: PushPayload,
  deliveryId: string,
): Promise<void> {
  await handlePushGeneric(
    db,
    {
      provider: "github",
      repoFullName: payload.repository.full_name,
      branch: payload.ref.replace(/^refs\/heads\//, ""),
      commitSha: payload.after,
      commitMessage: payload.head_commit?.message ?? "",
      authRef: String(payload.installation?.id ?? ""),
    },
    deliveryId,
  );
}
