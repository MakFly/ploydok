// SPDX-License-Identifier: AGPL-3.0-only
import { eq, and } from "drizzle-orm";
import { enqueueJob } from "@ploydok/db/queries";
import { apps } from "@ploydok/db";
import type { Db } from "@ploydok/db";
import type { ParsedPushEvent } from "@ploydok/shared";
import { childLogger } from "../logger";
import { deployQueue } from "../worker/queues";

const log = childLogger("webhook.push");

/**
 * Provider-agnostic push handler: matches apps by (provider, repo_full_name, branch)
 * and enqueues `deploy.requested` for each one.
 *
 * The `authRef` field on `ParsedPushEvent` carries provider-specific auth context:
 * - GitHub: the installation_id (number → string)
 * - GitLab: the user_id (owner of the OAuth token used for clone)
 */
export async function handlePushGeneric(
  db: Db,
  event: ParsedPushEvent,
  deliveryId: string,
): Promise<void> {
  log.info(
    {
      provider: event.provider,
      repoFullName: event.repoFullName,
      branch: event.branch,
      commitSha: event.commitSha,
      deliveryId,
    },
    "push event received",
  );

  const matchingApps = await db
    .select({ id: apps.id })
    .from(apps)
    .where(
      and(
        eq(apps.git_provider, event.provider),
        eq(apps.repo_full_name, event.repoFullName),
        eq(apps.branch, event.branch),
      ),
    );

  if (matchingApps.length === 0) {
    log.debug(
      { provider: event.provider, repoFullName: event.repoFullName, branch: event.branch },
      "no apps matched — skipping",
    );
    return;
  }

  log.info(
    {
      provider: event.provider,
      repoFullName: event.repoFullName,
      branch: event.branch,
      appCount: matchingApps.length,
    },
    "enqueueing deploy jobs",
  );

  for (const app of matchingApps) {
    const jobPayload = {
      appId: app.id,
      commitSha: event.commitSha,
      commitMessage: event.commitMessage,
      provider: event.provider,
      authRef: event.authRef,
      deliveryId,
    };
    await enqueueJob(db, {
      type: "deploy.requested",
      payload: jobPayload,
      maxAttempts: 1,
    });
    await deployQueue.add("deploy.requested", jobPayload, { attempts: 1 });
    log.info({ appId: app.id, commitSha: event.commitSha }, "deploy.requested enqueued");
  }
}
