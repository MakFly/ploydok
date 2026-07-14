// SPDX-License-Identifier: AGPL-3.0-only
import {
  DiskJobStatusSchema,
  DiskPruneResultSchema,
  DiskUsageResponseSchema,
} from "@ploydok/shared"
import { apiFetch } from "./api"
import type {
  DiskJobStatus,
  DiskPruneResult,
  DiskUsageResponse,
} from "@ploydok/shared"

export async function getDiskUsage(): Promise<DiskUsageResponse> {
  const data = await apiFetch<unknown>("/disk/usage")
  return DiskUsageResponseSchema.parse(data)
}

export async function pruneImages(): Promise<DiskPruneResult> {
  const data = await apiFetch<unknown>("/disk/prune/images", {
    method: "POST",
  })
  return DiskPruneResultSchema.parse(data)
}

export async function pruneBuildCache(): Promise<DiskPruneResult> {
  const data = await apiFetch<unknown>("/disk/prune/build-cache", {
    method: "POST",
  })
  return DiskPruneResultSchema.parse(data)
}

export async function getDiskJob(jobId: string): Promise<DiskJobStatus> {
  const data = await apiFetch<unknown>(`/disk/jobs/${jobId}`)
  return DiskJobStatusSchema.parse(data)
}
