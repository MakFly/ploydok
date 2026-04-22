// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import {
  Link,
  Outlet,
  createFileRoute,
  useRouterState,
} from "@tanstack/react-router"
import {
  RiFingerprintLine,
  RiMacbookLine,
  RiShieldCheckLine,
  RiShieldKeyholeLine,
} from "@remixicon/react"
import { cn } from "@workspace/ui/lib/utils"
import { ShellPage } from "../../../components/layout/AppShell"
import { SettingsTabs } from "../../../components/settings/SettingsTabs"

export const Route = createFileRoute("/_authed/settings/security")({
  component: SecurityLayout,
})

function SecurityLayout(): React.JSX.Element {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  return (
    <ShellPage
      title="Security"
      description="Lock down who can reach your Ploydok workspace. Manage passkeys, audit open sessions, and keep a recovery path in reserve."
    >
      <div className="space-y-6">
        <div className="space-y-4">
          <SettingsTabs />
          <SecuritySubTabs pathname={pathname} />
        </div>

        <Outlet />
      </div>
    </ShellPage>
  )
}

function SecuritySubTabs({
  pathname,
}: {
  pathname: string
}): React.JSX.Element {
  const subs = [
    {
      to: "/settings/security/passkey",
      label: "Passkeys",
      icon: RiFingerprintLine,
      matches: (currentPath: string) =>
        currentPath === "/settings/security/passkey" ||
        currentPath === "/settings/security/passkeys",
    },
    {
      to: "/settings/security/sessions",
      label: "Sessions",
      icon: RiMacbookLine,
      matches: (currentPath: string) =>
        currentPath === "/settings/security/sessions",
    },
    {
      to: "/settings/security/totp",
      label: "TOTP",
      icon: RiShieldCheckLine,
      matches: (currentPath: string) =>
        currentPath === "/settings/security/totp",
    },
    {
      to: "/settings/security/posture",
      label: "Posture",
      icon: RiShieldKeyholeLine,
      matches: (currentPath: string) =>
        currentPath === "/settings/security/posture",
    },
  ] as const

  return (
    <nav
      aria-label="Security sections"
      className="flex flex-wrap gap-1 border-b border-border"
    >
      {subs.map(({ to, label, icon: Icon, matches }) => {
        const active = matches(pathname)

        return (
          <Link
            key={to}
            to={to}
            className={cn(
              "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
