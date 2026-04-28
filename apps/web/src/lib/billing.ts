// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useSuspenseQuery } from "@tanstack/react-query"
import { apiFetchAllowErrorBody } from "./api"
import type {
  CheckoutResponse,
  CurrentPlanResponse,
  PortalResponse,
} from "@ploydok/shared"

export function useCurrentPlan(orgSlug: string) {
  return useSuspenseQuery({
    queryKey: ["billing", "current", orgSlug],
    queryFn: async (): Promise<CurrentPlanResponse> => {
      const { data } = await apiFetchAllowErrorBody(
        `/orgs/${orgSlug}/billing/current`,
        { method: "GET" }
      )
      return data as CurrentPlanResponse
    },
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
      const { response, data } = await apiFetchAllowErrorBody(
        `/orgs/${orgSlug}/billing/checkout`,
        {
          method: "POST",
          body: JSON.stringify({ planSlug }),
        }
      )
      if (!response.ok) {
        const errorMessage =
          data &&
          typeof data === "object" &&
          "error" in data &&
          typeof (data as Record<string, unknown>).error === "string"
            ? ((data as Record<string, unknown>).error as string)
            : "Checkout failed"
        throw new Error(errorMessage)
      }
      return data as CheckoutResponse
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
      const { response, data } = await apiFetchAllowErrorBody(
        `/orgs/${orgSlug}/billing/portal`,
        { method: "POST" }
      )
      if (!response.ok) {
        const errorMessage =
          data &&
          typeof data === "object" &&
          "error" in data &&
          typeof (data as Record<string, unknown>).error === "string"
            ? ((data as Record<string, unknown>).error as string)
            : "Portal failed"
        throw new Error(errorMessage)
      }
      return data as PortalResponse
    },
  })
}
