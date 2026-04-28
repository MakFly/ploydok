// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMatches } from "@tanstack/react-router"
import { toast } from "sonner"
import { apiFetch } from "./api"
import { useMe } from "./auth"
import type { ApiError } from "./api"
import type {
  CreateOrganizationBody,
  OrganizationResponse,
  OrganizationSummary,
  OrganizationsResponse,
} from "@ploydok/shared"

export function organizationDashboardPath(orgSlug: string): string {
  return `/orgs/${orgSlug}/dashboard`
}

export function organizationPath(
  orgSlug: string,
  suffix = "dashboard"
): string {
  return `/orgs/${orgSlug}/${suffix.replace(/^\/+/, "")}`
}

export function replaceOrganizationInPath(
  pathname: string,
  orgSlug: string
): string {
  if (pathname.startsWith("/orgs/")) {
    return pathname.replace(/^\/orgs\/[^/]+/, `/orgs/${orgSlug}`)
  }
  return organizationDashboardPath(orgSlug)
}

export function useOrganizations() {
  return useQuery<Array<OrganizationSummary>, ApiError>({
    queryKey: ["organizations"],
    queryFn: async () => {
      const data = await apiFetch<OrganizationsResponse>("/organizations")
      return data.organizations
    },
    staleTime: 30_000,
  })
}

export function useCreateOrganization() {
  const qc = useQueryClient()

  return useMutation<OrganizationSummary, ApiError, CreateOrganizationBody>({
    mutationFn: async (payload) => {
      const data = await apiFetch<OrganizationResponse>("/organizations", {
        method: "POST",
        body: payload,
      })
      return data.organization
    },
    onSuccess: async () => {
      toast.success("Workspace created")
      await qc.invalidateQueries({ queryKey: ["organizations"] })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })
}

export function useDeleteOrganization() {
  const qc = useQueryClient()

  return useMutation<void, ApiError, { slug: string }>({
    mutationFn: async ({ slug }) => {
      await apiFetch<void>(`/organizations/${slug}`, { method: "DELETE" })
    },
    onSuccess: async () => {
      toast.success("Workspace deleted")
      await qc.invalidateQueries({ queryKey: ["organizations"] })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })
}

export function useOrganizationBySlug(orgSlug: string) {
  return useQuery<OrganizationSummary, ApiError>({
    queryKey: ["organizations", orgSlug],
    queryFn: async () => {
      const data = await apiFetch<OrganizationResponse>(
        `/organizations/${orgSlug}`
      )
      return data.organization
    },
    enabled: Boolean(orgSlug),
    staleTime: 30_000,
  })
}

export function useCurrentOrganization(): OrganizationSummary | null {
  const matches = useMatches()
  const { data: me } = useMe()

  const orgMatch = matches.find(
    (match) => match.routeId === "/_authed/orgs/$orgSlug"
  )
  const loaderData = orgMatch?.loaderData as
    | { organization?: OrganizationSummary }
    | undefined
  return loaderData?.organization ?? me?.default_organization ?? null
}

export function useCurrentOrganizationSlug(): string | null {
  const matches = useMatches()
  const { data: me } = useMe()

  const orgMatch = matches.find(
    (match) => match.routeId === "/_authed/orgs/$orgSlug"
  )
  const orgSlug = orgMatch?.params?.orgSlug
  return orgSlug ?? me?.default_organization?.slug ?? null
}
