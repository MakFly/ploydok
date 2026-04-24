// SPDX-License-Identifier: AGPL-3.0-only
import { apiFetch } from "./api/client"
import type {
  SSOConfigSummary,
  SSOConfigCreateBody,
  SSOConfigUpdateBody,
  SSOTestResponse,
} from "@ploydok/shared"

/**
 * Fetch SSO config for an organization.
 */
export async function getSSOConfig(
  orgSlug: string
): Promise<{ config: SSOConfigSummary | null } | null> {
  try {
    return await apiFetch<{ config: SSOConfigSummary | null }>(
      `/orgs/${orgSlug}/sso-configs`,
      {
        method: "GET",
      }
    )
  } catch {
    return null
  }
}

/**
 * Create SSO config for an organization.
 */
export async function createSSOConfig(
  orgSlug: string,
  body: SSOConfigCreateBody
): Promise<{ config: SSOConfigSummary } | null> {
  try {
    return await apiFetch<{ config: SSOConfigSummary }>(
      `/orgs/${orgSlug}/sso-configs`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    )
  } catch {
    return null
  }
}

/**
 * Update SSO config for an organization.
 */
export async function updateSSOConfig(
  orgSlug: string,
  body: SSOConfigUpdateBody
): Promise<{ config: SSOConfigSummary } | null> {
  try {
    return await apiFetch<{ config: SSOConfigSummary }>(
      `/orgs/${orgSlug}/sso-configs`,
      {
        method: "PATCH",
        body: JSON.stringify(body),
      }
    )
  } catch {
    return null
  }
}

/**
 * Delete SSO config for an organization.
 */
export async function deleteSSOConfig(orgSlug: string): Promise<boolean> {
  try {
    await apiFetch<{ ok: boolean }>(`/orgs/${orgSlug}/sso-configs`, {
      method: "DELETE",
    })
    return true
  } catch {
    return false
  }
}

/**
 * Test OIDC connection.
 */
export async function testSSOConnection(
  orgSlug: string
): Promise<SSOTestResponse> {
  try {
    return await apiFetch<SSOTestResponse>(
      `/orgs/${orgSlug}/sso-configs/test`,
      {
        method: "POST",
      }
    )
  } catch {
    return { ok: false, error: "Failed to test connection" }
  }
}

/**
 * Initiate SSO login.
 */
export function initiateSSOLogin(orgSlug: string): void {
  window.location.href = `/auth/sso/${orgSlug}/login`
}
