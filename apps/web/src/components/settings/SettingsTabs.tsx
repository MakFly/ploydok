// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Link, useRouterState } from "@tanstack/react-router"
import { RiShieldCheckLine, RiUserLine } from "@remixicon/react"
import { useTranslation } from "react-i18next"
import { cn } from "@workspace/ui/lib/utils"

export function SettingsTabs(): React.JSX.Element {
  const { t } = useTranslation("settings")
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  const tabs = [
    {
      to: "/settings",
      label: t("account"),
      icon: RiUserLine,
      matches: (p: string) => p === "/settings" || p === "/settings/",
    },
    {
      to: "/settings/security",
      label: t("security.title"),
      icon: RiShieldCheckLine,
      matches: (p: string) => p.startsWith("/settings/security"),
    },
  ] as const

  return (
    <div
      role="tablist"
      aria-label={t("security.tabsAria")}
      className="inline-flex w-full items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5 md:w-auto"
    >
      {tabs.map(({ to, label, icon: Icon, matches }) => {
        const active = matches(pathname)
        return (
          <Link
            key={to}
            to={to}
            role="tab"
            aria-selected={active}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors md:flex-none",
              active
                ? "bg-background text-foreground shadow-[0_0_0_1px_var(--border)]"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </Link>
        )
      })}
    </div>
  )
}
