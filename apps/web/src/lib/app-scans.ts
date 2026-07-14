// SPDX-License-Identifier: AGPL-3.0-only
import { BuildScanSummarySchema } from "@ploydok/shared"
import { apiFetch } from "./api"
import type { BuildScanSummary } from "@ploydok/shared"

export async function getLatestScan(
  appId: string
): Promise<BuildScanSummary | null> {
  const data = await apiFetch<{ scan: unknown }>(
    `/apps/${encodeURIComponent(appId)}/scans/latest`
  )
  return data.scan === null ? null : BuildScanSummarySchema.parse(data.scan)
}
