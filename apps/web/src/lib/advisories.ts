// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "./api"

export interface AdvisoryRow {
  match: {
    id: string
    advisory_id: string
    scope: "platform" | "app"
    app_id: string | null
    project_id: string | null
    ecosystem: string
    package_name: string
    current_version: string
    manifest_path: string
    severity_level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN"
    first_seen_at: string
    last_seen_at: string
    fixed_at: string | null
    acknowledged_at: string | null
  }
  advisory: {
    id: string
    summary: string | null
    details: string | null
    aliases: Array<string> | null
    severity_level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN"
    references: Array<{ url?: string }> | null
    published_at: string | null
    modified_at: string | null
    withdrawn_at: string | null
  }
  app_name?: string | null
  app_slug?: string | null
  org_slug?: string | null
}

export interface AdvisoriesResponse {
  disabled: boolean
  matches: Array<AdvisoryRow>
}

export function useAdminAdvisories() {
  return useQuery({
    queryKey: ["admin", "advisories"],
    queryFn: () => apiFetch<AdvisoriesResponse>("/admin/advisories"),
  })
}

export function useRefreshAdvisories() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiFetch<{ queued?: boolean; disabled?: boolean; jobId?: string }>(
        "/admin/advisories/refresh",
        { method: "POST" }
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "advisories"] })
    },
  })
}

export function useAcknowledgeAdvisory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: { matchId: string; note?: string }) =>
      apiFetch(`/admin/advisories/${encodeURIComponent(args.matchId)}/acknowledge`, {
        method: "POST",
        body: JSON.stringify({ note: args.note ?? "" }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "advisories"] })
      void qc.invalidateQueries({ queryKey: ["app", "advisories"] })
    },
  })
}

export function useAppAdvisories(orgSlug: string, appId: string) {
  return useQuery({
    queryKey: ["app", "advisories", orgSlug, appId],
    queryFn: () =>
      apiFetch<AdvisoriesResponse>(
        `/organizations/${encodeURIComponent(orgSlug)}/apps/${encodeURIComponent(appId)}/advisories`
      ),
    enabled: Boolean(orgSlug && appId),
  })
}
