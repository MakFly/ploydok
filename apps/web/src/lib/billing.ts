// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useSuspenseQuery } from "@tanstack/react-query"
import { apiFetch } from "./api"
import type {
  CheckoutResponse,
  CurrentPlanResponse,
  PortalResponse,
} from "@ploydok/shared"

export function useCurrentPlan(orgSlug: string) {
  return useSuspenseQuery({
    queryKey: ["billing", "current", orgSlug],
    queryFn: (): Promise<CurrentPlanResponse> =>
      apiFetch<CurrentPlanResponse>(`/orgs/${orgSlug}/billing/current`),
  })
}

export function useCheckoutSession() {
  return useMutation({
    mutationFn: async ({
      planSlug,
      orgSlug,
    }: {
      planSlug: "pro" | "enterprise"
      orgSlug: string
    }): Promise<CheckoutResponse> => {
      return apiFetch<CheckoutResponse>(`/orgs/${orgSlug}/billing/checkout`, {
        method: "POST",
        body: { planSlug },
      })
    },
  })
}

export function useBillingPortal() {
  return useMutation({
    mutationFn: async ({
      orgSlug,
    }: {
      orgSlug: string
    }): Promise<PortalResponse> => {
      return apiFetch<PortalResponse>(`/orgs/${orgSlug}/billing/portal`, {
        method: "POST",
      })
    },
  })
}
