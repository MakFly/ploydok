// SPDX-License-Identifier: AGPL-3.0-only
import type * as React from "react"
import { createFileRoute, Link, Outlet } from "@tanstack/react-router"

export const Route = createFileRoute("/_authed/orgs/$orgSlug/settings")({
  component: SettingsLayout,
})

function SettingsLayout(): React.JSX.Element {
  const { orgSlug } = Route.useParams()

  const tabClass =
    "rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground data-[status=active]:bg-muted data-[status=active]:text-foreground"

  return (
    <div className="flex size-full flex-col gap-4 overflow-y-auto p-4 md:p-8">
      <nav
        className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1"
        aria-label="Workspace settings"
      >
        <Link
          to="/orgs/$orgSlug/settings/billing"
          params={{ orgSlug }}
          search={{ success: false, canceled: false }}
          className={tabClass}
          activeProps={{ "data-status": "active" }}
        >
          Billing
        </Link>
        <Link
          to="/orgs/$orgSlug/settings/sso"
          params={{ orgSlug }}
          className={tabClass}
          activeProps={{ "data-status": "active" }}
        >
          SSO
        </Link>
        <Link
          to="/orgs/$orgSlug/branding"
          params={{ orgSlug }}
          className={tabClass}
          activeProps={{ "data-status": "active" }}
        >
          Branding
        </Link>
      </nav>
      <Outlet />
    </div>
  )
}
