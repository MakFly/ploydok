// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod"
import type { Db } from "@ploydok/db"
import { updatePreviewDeploymentStatus } from "@ploydok/db/queries"
import { workerLog } from "../logger"

const log = workerLog.child({ subsystem: "preview-deploy" })

const PreviewDeployPayloadSchema = z.object({
  appId: z.string(),
  prNumber: z.number(),
  headSha: z.string(),
})

/**
 * Build and deploy a preview container for a PR.
 * Placeholder implementation: marks the preview as building then running.
 * Full build/deploy logic deferred to Phase 2.
 */
export async function handlePreviewDeploy(
  db: Db,
  payload: unknown
): Promise<void> {
  const parsed = PreviewDeployPayloadSchema.safeParse(payload)
  if (!parsed.success) {
    log.error({ issues: parsed.error.issues }, "invalid preview deploy payload")
    throw new Error("Invalid preview deploy payload")
  }

  const { appId, prNumber, headSha } = parsed.data
  const previewId = `${appId}:pr-${prNumber}`

  try {
    log.info({ appId, prNumber, headSha }, "starting preview deploy")

    await updatePreviewDeploymentStatus(db, previewId, "building")

    log.debug(
      { appId, prNumber },
      "preview deploy placeholder — full build logic deferred to phase 2"
    )
    await updatePreviewDeploymentStatus(db, previewId, "running")

    log.info({ appId, prNumber }, "preview deploy complete")
  } catch (error) {
    log.error({ appId, prNumber, error }, "preview deploy failed")
    await updatePreviewDeploymentStatus(db, previewId, "failed")
    throw error
  }
}
