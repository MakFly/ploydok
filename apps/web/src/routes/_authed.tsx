// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Outlet, createFileRoute } from "@tanstack/react-router"
import { AppShell } from "../components/layout/AppShell"
import { SecondFactorBanner } from "../components/auth/SecondFactorBanner"
import { EventsProvider } from "../lib/events-provider"
import { useDeploymentToasts } from "../lib/deployment-toasts"
import { requireMe } from "../lib/auth-guards"
import { getGitProviderStatus } from "../lib/git-providers"
import { redirect } from "@tanstack/react-router"
import type { Me } from "@ploydok/shared"

function AuthedLayout(): React.JSX.Element {
  useDeploymentToasts()
  return (
    <AppShell banner={<SecondFactorBanner />}>
      <Outlet />
    </AppShell>
  )
}

// Legacy path redirects (/dashboard, /apps/**, /databases/**) are handled by
// dedicated splat/stub routes — see _authed/dashboard.tsx, _authed/apps.$.tsx
// and _authed/databases.$.tsx. This layout just runs the shared auth guard.
export const Route = createFileRoute("/_authed")({
  beforeLoad: async ({ location }): Promise<{ me: Me }> => {
    const me = await requireMe()
    const providers = await getGitProviderStatus()
    const providerSettings = location.pathname.startsWith(
      "/settings/git-providers"
    )
    if (!providers.ready && !providerSettings) {
      throw redirect({ to: "/onboarding" })
    }
    return { me }
  },
  component: () => (
    <EventsProvider>
      <AuthedLayout />
    </EventsProvider>
  ),
})
