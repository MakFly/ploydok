// SPDX-License-Identifier: AGPL-3.0-only
import { eq, and, count } from "drizzle-orm"
import { apps, webhook_deliveries } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import type { ParsedPushEvent } from "@ploydok/shared"
import { nanoid } from "nanoid"
import { childLogger } from "../logger"
import { deployQueue } from "../worker/queues"
import { filterPushEvent, matchesTagPattern } from "../webhooks/filters"
import { insertDelivery, markDeliveryCoalesced } from "../webhooks/deliveries"

const log = childLogger("webhook.push")

/**
 * Provider-agnostic push handler: matches apps by (provider, repo_full_name)
 * then applies the filter chain and enqueues via BullMQ with coalescing.
 *
 * The `authRef` field on `ParsedPushEvent` carries provider-specific auth context:
 * - GitHub: the installation_id (number → string)
 * - GitLab: the user_id (owner of the OAuth token used for clone)
 */
export async function handlePushGeneric(
  db: Db,
  event: ParsedPushEvent & { changedFiles?: string[]; payloadHash?: string; rawBody?: Buffer },
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
  )

  const matchingApps = await db
    .select({
      id: apps.id,
      auto_deploy_enabled: apps.auto_deploy_enabled,
      branch: apps.branch,
      watch_paths: apps.watch_paths,
      coalesce_pushes: apps.coalesce_pushes,
      deploy_on_tag: apps.deploy_on_tag,
      tag_pattern: apps.tag_pattern,
    })
    .from(apps)
    .where(
      and(
        eq(apps.git_provider, event.provider),
        eq(apps.repo_full_name, event.repoFullName),
      ),
    )

  if (matchingApps.length === 0) {
    log.debug(
      { provider: event.provider, repoFullName: event.repoFullName },
      "no apps matched — skipping",
    )
    // Record unknown-app delivery when we have a hash
    if (event.payloadHash) {
      await insertDelivery(
        db,
        {
          provider: event.provider,
          event: "push",
          ref: event.branch,
          commit_sha: event.commitSha,
          commit_message: event.commitMessage,
          signature_valid: true,
          decision: "skipped_unknown_app",
          decision_reason: "no app matched repo+provider",
          payload_hash: event.payloadHash,
        },
        event.rawBody,
      )
    }
    return
  }

  // Detect tag pushes (refs/tags/*) and route to tag-specific logic
  const isTagPush = event.ref?.startsWith("refs/tags/")
  const tagName = isTagPush ? event.ref!.replace(/^refs\/tags\//, "") : undefined

  for (const app of matchingApps) {
    const baseDeliveryRow = {
      app_id: app.id,
      provider: event.provider as "github" | "gitlab",
      delivery_external_id: deliveryId,
      event: "push",
      ref: event.ref ?? event.branch,
      commit_sha: event.commitSha,
      commit_message: event.commitMessage,
      signature_valid: true,
      payload_hash: event.payloadHash ?? "",
    }

    if (isTagPush && tagName !== undefined) {
      // Tag push path
      if (!app.deploy_on_tag) {
        log.debug({ appId: app.id, tagName }, "tag push — deploy_on_tag=false, skipping")
        await insertDelivery(
          db,
          {
            ...baseDeliveryRow,
            decision: "skipped_tag_disabled",
            decision_reason: "deploy_on_tag=false",
          },
          event.rawBody,
        )
        continue
      }

      if (!matchesTagPattern(tagName, app.tag_pattern)) {
        log.debug({ appId: app.id, tagName, pattern: app.tag_pattern }, "tag push — pattern mismatch, skipping")
        await insertDelivery(
          db,
          {
            ...baseDeliveryRow,
            decision: "skipped_tag_pattern",
            decision_reason: `tag "${tagName}" does not match pattern "${app.tag_pattern}"`,
          },
          event.rawBody,
        )
        continue
      }

      // Tag push is accepted — enqueue with kind=tag metadata
      const newDeliveryId = await insertDelivery(
        db,
        {
          ...baseDeliveryRow,
          decision: "enqueued",
          decision_reason: "tag push accepted",
        },
        event.rawBody,
      )

      const jobId = nanoid()
      await deployQueue.add(
        "deploy.requested",
        {
          appId: app.id,
          commitSha: event.commitSha,
          commitMessage: event.commitMessage,
          provider: event.provider,
          authRef: event.authRef,
          deliveryId: newDeliveryId,
          kind: "tag",
          tag: tagName,
        },
        {
          jobId,
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      )

      log.info({ appId: app.id, tagName, commitSha: event.commitSha, jobId }, "tag deploy.requested enqueued")
      continue
    }

    // Branch push path (original logic)
    const filterEventArgs: Parameters<typeof filterPushEvent>[1] = {
      branch: event.branch,
      commitMessage: event.commitMessage,
    }
    if (event.changedFiles) filterEventArgs.changedFiles = event.changedFiles
    const filterResult = filterPushEvent(app, filterEventArgs)

    if (filterResult.decision !== "enqueued") {
      log.debug(
        { appId: app.id, decision: filterResult.decision, reason: filterResult.reason },
        "push filtered",
      )
      await insertDelivery(
        db,
        {
          ...baseDeliveryRow,
          decision: filterResult.decision,
          decision_reason: filterResult.reason,
        },
        event.rawBody,
      )
      continue
    }

    // Build the deploy job payload
    const jobPayload = {
      appId: app.id,
      commitSha: event.commitSha,
      commitMessage: event.commitMessage,
      provider: event.provider,
      authRef: event.authRef,
      deliveryId,
    }

    // Coalescing: if coalesce_pushes=true, use a deterministic jobId so we
    // can detect and drop any waiting/delayed job for the same app+branch.
    const shouldCoalesce = app.coalesce_pushes
    let jobId: string

    if (shouldCoalesce) {
      jobId = `deploy:${app.id}:${event.branch}`

      // Check if a job with this id is already waiting or delayed
      const existingJob = await deployQueue.getJob(jobId)
      if (existingJob) {
        const state = await existingJob.getState()
        if (state === "waiting" || state === "delayed") {
          // Drop the old job and mark its delivery as coalesced
          await existingJob.remove()
          log.info(
            { event: "webhook.coalesced", app_id: app.id, dropped_job_id: jobId, reason: "newer push supersedes" },
            "coalesced waiting deploy job",
          )
          // Mark any recent enqueued delivery for this app as coalesced
          const recentDeliveries = await db
            .select({ id: webhook_deliveries.id })
            .from(webhook_deliveries)
            .where(
              and(
                eq(webhook_deliveries.app_id, app.id),
                eq(webhook_deliveries.decision, "enqueued"),
              ),
            )
            .limit(1)
          if (recentDeliveries[0]) {
            await markDeliveryCoalesced(db, recentDeliveries[0].id)
          }
        } else if (state === "active") {
          // Job is running — use a unique suffixed id to avoid conflict
          const retryCount = await db
            .select({ c: count() })
            .from(webhook_deliveries)
            .where(eq(webhook_deliveries.app_id, app.id))
          const n = retryCount[0]?.c ?? 0
          jobId = `deploy:${app.id}:${event.branch}:r${n}`
        }
      }
    } else {
      jobId = nanoid()
    }

    // Insert the delivery record
    const newDeliveryId = await insertDelivery(
      db,
      {
        ...baseDeliveryRow,
        decision: "enqueued",
        decision_reason: filterResult.reason,
      },
      event.rawBody,
    )

    await deployQueue.add("deploy.requested", { ...jobPayload, deliveryId: newDeliveryId }, {
      jobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    })

    log.info(
      { appId: app.id, commitSha: event.commitSha, jobId, coalesced: shouldCoalesce },
      "deploy.requested enqueued",
    )
  }
}
