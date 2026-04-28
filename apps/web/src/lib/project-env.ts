// SPDX-License-Identifier: AGPL-3.0-only
import { useSuspenseQuery } from "@tanstack/react-query"
import { apiFetch } from "./api"
import type { ProjectEnvVar } from "@ploydok/shared"

export interface ProjectEnvVarDisplay extends ProjectEnvVar {
  updatedAt: string
}

export function useProjectEnv(projectId: string | null) {
  return useSuspenseQuery({
    queryKey: ["projectEnv", projectId],
    queryFn: async () => {
      if (!projectId) return { vars: [] as Array<ProjectEnvVarDisplay> }
      const data = await apiFetch<{ vars: Array<ProjectEnvVarDisplay> }>(
        `/projects/${projectId}/env`
      )
      return data
    },
  })
}

export async function revealProjectEnvVar(
  projectId: string,
  key: string
): Promise<string> {
  const data = await apiFetch<{ value: string }>(
    `/projects/${projectId}/env/reveal/${key}`
  )
  return data.value
}

export async function upsertProjectEnvVars(
  projectId: string,
  vars: Array<ProjectEnvVar>
): Promise<Array<ProjectEnvVarDisplay>> {
  const data = await apiFetch<{ vars: Array<ProjectEnvVarDisplay> }>(
    `/projects/${projectId}/env`,
    {
      method: "PUT",
      body: JSON.stringify({ vars }),
    }
  )
  return data.vars
}

export async function deleteProjectEnvVar(
  projectId: string,
  key: string
): Promise<void> {
  await apiFetch(`/projects/${projectId}/env/${key}`, {
    method: "DELETE",
  })
}
