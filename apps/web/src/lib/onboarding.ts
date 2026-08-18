// SPDX-License-Identifier: AGPL-3.0-only
import { createIsomorphicFn } from "@tanstack/react-start"
import { organizationDashboardPath } from "./organizations"

export type OnboardingDeploymentSource = "github" | "gitlab" | "image"

const SOURCE_COOKIE = "ploydok-onboarding-source"

function sourceCookieValue(userId: string): string {
  return `${encodeURIComponent(userId)}:image`
}

export function rememberOnboardingDeploymentSource(
  userId: string,
  source: OnboardingDeploymentSource
): void {
  if (typeof document === "undefined") return

  const secure = window.location.protocol === "https:" ? "; Secure" : ""
  document.cookie =
    source === "image"
      ? `${SOURCE_COOKIE}=${sourceCookieValue(userId)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`
      : `${SOURCE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`
}

export const getRememberedOnboardingDeploymentSource = createIsomorphicFn()
  .client((userId: string): OnboardingDeploymentSource | null => {
    const match = document.cookie.match(
      new RegExp(`(?:^|; )${SOURCE_COOKIE}=([^;]*)`)
    )
    return match?.[1] === sourceCookieValue(userId) ? "image" : null
  })
  .server(
    async (userId: string): Promise<OnboardingDeploymentSource | null> => {
      try {
        const { getCookies } = await import("@tanstack/react-start/server")
        const cookies = getCookies()
        return cookies[SOURCE_COOKIE] === sourceCookieValue(userId)
          ? "image"
          : null
      } catch {
        return null
      }
    }
  )

export function onboardingDashboardHref(
  slug: string | undefined,
  source: OnboardingDeploymentSource
): string {
  const dashboard = slug ? organizationDashboardPath(slug) : "/dashboard"
  return `${dashboard}?create=${source}`
}
