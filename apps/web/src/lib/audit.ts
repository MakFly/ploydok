// SPDX-License-Identifier: AGPL-3.0-only
import { useSuspenseQuery } from "@tanstack/react-query"
import { AuditListResponseSchema } from "@ploydok/shared"
import { apiFetch } from "./api"

export interface UseAuditEventsOptions {
  limit?: number
  cursor?: number
  actionPrefix?: string
  targetType?: string
}

/**
 * Hook to fetch audit events for an organization.
 * Uses suspense query for convenient loading state management.
 */
export function useAuditEvents(
  orgId: string,
  opts: UseAuditEventsOptions = {}
) {
  const { limit = 50, cursor, actionPrefix, targetType } = opts

  const params = new URLSearchParams({
    orgId,
    limit: limit.toString(),
  })

  if (cursor !== undefined) {
    params.append("cursor", cursor.toString())
  }

  if (actionPrefix) {
    params.append("actionPrefix", actionPrefix)
  }

  if (targetType) {
    params.append("targetType", targetType)
  }

  return useSuspenseQuery({
    queryKey: ["audit", orgId, { limit, cursor, actionPrefix, targetType }],
    queryFn: async () => {
      const response = (await apiFetch(`/audit?${params}`)) as Response

      if (!response.ok) {
        throw new Error("Failed to fetch audit events")
      }

      const data = (await response.json()) as unknown
      return AuditListResponseSchema.parse(data)
    },
  })
}
