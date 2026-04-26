// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod"
import type { Db } from "@ploydok/db"
import { updatePreviewDeploymentStatus } from "@ploydok/db/queries"
import { workerLog } from "../logger"

const log = workerLog.child({ subsystem: "preview-teardown" })

const PreviewTeardownPayloadSchema = z.object({
  appId: z.string(),
  prNumber: z.number(),
})

/**
 * Stop and remove the preview deployment container for a closed PR.
 * Placeholder implementation: marks the preview as torn_down.
 * Full container cleanup logic deferred to Phase 2.
 */
export async function handlePreviewTeardown(
  db: Db,
  payload: unknown
): Promise<void> {
  const parsed = PreviewTeardownPayloadSchema.safeParse(payload)
  if (!parsed.success) {
    log.error(
      { issues: parsed.error.issues },
      "invalid preview teardown payload"
    )
    throw new Error("Invalid preview teardown payload")
  }

  const { appId, prNumber } = parsed.data
  const previewId = `${appId}:pr-${prNumber}`

  try {
    log.info({ appId, prNumber }, "starting preview teardown")

    log.debug(
      { appId, prNumber },
      "preview teardown placeholder — full container cleanup deferred to phase 2"
    )

    await updatePreviewDeploymentStatus(db, previewId, "torn_down")

    log.info({ appId, prNumber }, "preview teardown complete")
  } catch (error) {
    log.error({ appId, prNumber, error }, "preview teardown failed")
    throw error
  }
}
