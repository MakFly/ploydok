// SPDX-License-Identifier: AGPL-3.0-only
import { eq, and } from "drizzle-orm";
import { enqueueJob } from "@ploydok/db/queries";
import { apps } from "@ploydok/db";
import type { Db } from "@ploydok/db";
import { childLogger } from "../../logger";
import type { PushPayload } from "../webhook";

const log = childLogger("webhook.push");

// ---------------------------------------------------------------------------
// Push handler
// ---------------------------------------------------------------------------

/**
 * Handle a GitHub push event: find apps configured for the repo+branch and
 * enqueue a `deploy.requested` job for each one.
 */
export async function handlePush(
  db: Db,
  payload: PushPayload,
  deliveryId: string,
): Promise<void> {
  const repoFullName = payload.repository.full_name;
  // ref is e.g. "refs/heads/main" — strip the prefix
  const branch = payload.ref.replace(/^refs\/heads\//, "");
  const commitSha = payload.after;
  const commitMessage = payload.head_commit?.message ?? null;
  const installationId = payload.installation?.id;

  log.info({ repoFullName, branch, commitSha, deliveryId }, "push event received");

  // Find all apps configured for this repo + branch
  const matchingApps = await db
    .select({ id: apps.id })
    .from(apps)
    .where(
      and(
        eq(apps.repo_full_name, repoFullName),
        eq(apps.branch, branch),
      ),
    );

  if (matchingApps.length === 0) {
    log.debug({ repoFullName, branch }, "no apps matched — skipping");
    return;
  }

  log.info(
    { repoFullName, branch, appCount: matchingApps.length },
    "enqueueing deploy jobs",
  );

  for (const app of matchingApps) {
    await enqueueJob(db, {
      type: "deploy.requested",
      payload: {
        appId: app.id,
        commitSha,
        commitMessage,
        installationId: installationId ?? null,
        deliveryId,
      },
    });
    log.info({ appId: app.id, commitSha }, "deploy.requested enqueued");
  }
}
