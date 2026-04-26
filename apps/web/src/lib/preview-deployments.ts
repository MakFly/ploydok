// SPDX-License-Identifier: AGPL-3.0-only
import { apiFetch } from "./api/client"

export interface PreviewDeployment {
  id: string
  pr_number: number
  head_sha: string
  domain: string | null
  container_id: string | null
  status: "pending" | "building" | "running" | "torn_down" | "failed"
  created_at: string
  expires_at: string | null
}

export async function listPreviewDeployments(
  appId: string
): Promise<PreviewDeployment[]> {
  return apiFetch<PreviewDeployment[]>(`/apps/${appId}/previews`)
}

export async function getPreviewDeployment(
  appId: string,
  prNumber: number
): Promise<PreviewDeployment> {
  return apiFetch<PreviewDeployment>(`/apps/${appId}/previews/${prNumber}`)
}

export async function teardownPreviewDeployment(
  appId: string,
  prNumber: number
): Promise<void> {
  await apiFetch(`/apps/${appId}/previews/${prNumber}/teardown`, {
    method: "POST",
  })
}
