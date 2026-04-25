// SPDX-License-Identifier: AGPL-3.0-only
import { apiFetch } from "./api"
import type {
  ScheduledJobSummary,
  ScheduledJobDetail,
  ScheduledJobRun,
  ScheduledJobCreateInput,
} from "@ploydok/shared"

export async function listScheduledJobs(
  orgSlug: string
): Promise<ScheduledJobSummary[]> {
  const data = await apiFetch<{ jobs: ScheduledJobSummary[] }>(
    `/orgs/${orgSlug}/scheduled-jobs`
  )
  return data.jobs
}

export async function getScheduledJob(
  orgSlug: string,
  jobId: string
): Promise<{ job: ScheduledJobDetail; recentRuns: ScheduledJobRun[] }> {
  return apiFetch<{ job: ScheduledJobDetail; recentRuns: ScheduledJobRun[] }>(
    `/orgs/${orgSlug}/scheduled-jobs/${jobId}`
  )
}

export async function createScheduledJob(
  orgSlug: string,
  input: ScheduledJobCreateInput
): Promise<ScheduledJobSummary> {
  return apiFetch<ScheduledJobSummary>(`/orgs/${orgSlug}/scheduled-jobs`, {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function updateScheduledJob(
  orgSlug: string,
  jobId: string,
  input: Partial<ScheduledJobCreateInput>
): Promise<ScheduledJobSummary> {
  return apiFetch<ScheduledJobSummary>(
    `/orgs/${orgSlug}/scheduled-jobs/${jobId}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    }
  )
}

export async function deleteScheduledJob(
  orgSlug: string,
  jobId: string
): Promise<void> {
  await apiFetch(`/orgs/${orgSlug}/scheduled-jobs/${jobId}`, {
    method: "DELETE",
  })
}

export async function triggerScheduledJobRun(
  orgSlug: string,
  jobId: string
): Promise<ScheduledJobRun> {
  return apiFetch<ScheduledJobRun>(
    `/orgs/${orgSlug}/scheduled-jobs/${jobId}/run`,
    { method: "POST" }
  )
}
