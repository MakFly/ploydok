// SPDX-License-Identifier: AGPL-3.0-only
import { env } from "../env"

/**
 * The only paths a Git-provider round-trip is allowed to come back to.
 * Membership is checked both when the value is signed into a state cookie and
 * again right before the redirect is issued, so a cookie minted by an instance
 * running an older allow-list can never widen this one.
 */
export const PROVIDER_RETURN_PATHS = [
  "/onboarding",
  "/settings/git-providers/github",
  "/settings/git-providers/gitlab",
] as const

export type ProviderReturnPath = (typeof PROVIDER_RETURN_PATHS)[number]

export const GITHUB_RETURN_FALLBACK: ProviderReturnPath =
  "/settings/git-providers/github"
export const GITLAB_RETURN_FALLBACK: ProviderReturnPath =
  "/settings/git-providers/gitlab"

/**
 * Resolves an untrusted value to one of the literals above. Never echoes the
 * input, so absolute URLs, scheme-relative `//host` forms and `javascript:`
 * payloads all collapse to the fallback.
 */
export function sanitizeReturnTo(
  raw: unknown,
  fallback: ProviderReturnPath
): ProviderReturnPath {
  if (typeof raw !== "string") return fallback
  return PROVIDER_RETURN_PATHS.find((allowed) => allowed === raw) ?? fallback
}

export function buildReturnUrl(
  returnTo: ProviderReturnPath,
  params?: URLSearchParams
): string {
  const url = new URL(returnTo, env.WEB_ORIGIN)
  if (params) {
    const qs = params.toString()
    if (qs) url.search = qs
  }
  return url.toString()
}
