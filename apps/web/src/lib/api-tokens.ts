// SPDX-License-Identifier: AGPL-3.0-only
import type {
  ApiTokenCreateInput,
  ApiTokenResponse,
  ApiTokenSummary,
} from "@ploydok/shared"
import { apiFetch } from "./api"

export async function createApiToken(
  input: ApiTokenCreateInput
): Promise<ApiTokenResponse> {
  return apiFetch<ApiTokenResponse>("/api-tokens", {
    method: "POST",
    body: input,
  })
}

export async function listApiTokens(): Promise<ApiTokenSummary[]> {
  const data = await apiFetch<{ tokens: ApiTokenSummary[] }>("/api-tokens", {
    method: "GET",
  })
  return data.tokens
}

export async function revokeApiToken(tokenId: string): Promise<void> {
  await apiFetch<{ success: boolean }>(`/api-tokens/${tokenId}`, {
    method: "DELETE",
  })
}
