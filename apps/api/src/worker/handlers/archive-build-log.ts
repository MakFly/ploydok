// SPDX-License-Identifier: AGPL-3.0-only
import type { Db } from "@ploydok/db"
import { archiveBuildLog } from "../../services/build-log-archive"
import { childLogger } from "../../logger"

const log = childLogger("worker.logs.archive")

export interface ArchiveBuildLogPayload {
  buildId: string
}

export async function handleArchiveBuildLog(
  db: Db,
  payload: ArchiveBuildLogPayload
): Promise<void> {
  if (!payload || typeof payload.buildId !== "string" || !payload.buildId) {
    log.warn({ payload }, "archive job dropped: invalid payload")
    return
  }
  await archiveBuildLog(db, payload.buildId)
}
