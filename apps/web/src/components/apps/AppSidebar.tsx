// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Link, useRouterState } from "@tanstack/react-router"
import {
  RiDashboardLine,
  RiGitBranchLine,
  RiGitCommitLine,
  RiGlobalLine,
  RiKey2Line,
  RiRocketLine,
  RiSettings3Line,
  RiTerminalLine,
} from "@remixicon/react"
import { useTabShortcuts } from "../../lib/hooks/use-tab-shortcuts"
import { AppStatusBadge } from "./AppStatusBadge"
import type { AppDetail } from "../../lib/apps"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AppSidebarProps {
  app: AppDetail
  appId: string
}

interface NavItem {
  label: string
  to: string
  icon: React.ComponentType<{ className?: string }>
  shortcut: string
}

// ---------------------------------------------------------------------------
// Nav items — order matches UX spec
// ---------------------------------------------------------------------------

const NAV_ITEMS: Array<NavItem> = [
  { label: "Overview", to: "/apps/$id/overview", icon: RiDashboardLine, shortcut: "g o" },
  { label: "Deployments", to: "/apps/$id/deployments", icon: RiRocketLine, shortcut: "g d" },
  { label: "Logs", to: "/apps/$id/logs", icon: RiTerminalLine, shortcut: "g l" },
  { label: "Settings", to: "/apps/$id/settings", icon: RiSettings3Line, shortcut: "g s" },
  { label: "Env", to: "/apps/$id/env", icon: RiKey2Line, shortcut: "g e" },
  { label: "Domains", to: "/apps/$id/domains", icon: RiGlobalLine, shortcut: "g n" },
]

// ---------------------------------------------------------------------------
// Helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Returns the nav item label that matches the current pathname, or null if
 * no item matches. Matching is exact on the resolved path (with $id replaced).
 */
export function getActiveNavLabel(
  pathname: string,
  appId: string,
  items: Array<{ label: string; to: string }> = NAV_ITEMS,
): string | null {
  for (const item of items) {
    const resolved = item.to.replace("$id", appId)
    if (pathname === resolved || pathname.startsWith(resolved + "/")) {
      return item.label
    }
  }
  return null
}

/**
 * Truncates a commit SHA to 7 characters (standard short form).
 */
export function truncateSha(sha: string | undefined): string {
  if (!sha) return "—"
  return sha.slice(0, 7)
}

/**
 * Extracts the quick-info rows from an AppDetail, returning label/value pairs.
 * Values are raw strings — display concerns belong to the component.
 */
export interface QuickInfoRow {
  label: string
  value: string
  href?: string
  title?: string
}

export function buildQuickInfo(app: AppDetail): Array<QuickInfoRow> {
  const rows: Array<QuickInfoRow> = []

  if (app.branch) {
    rows.push({ label: "Branch", value: app.branch })
  }

  if (app.currentCommitSha) {
    rows.push({
      label: "Commit",
      value: truncateSha(app.currentCommitSha),
      title: app.currentCommitSha,
    })
  }

  if (app.domain) {
    rows.push({
      label: "Domain",
      value: app.domain,
      href: `https://${app.domain}`,
    })
  }

  return rows
}

// ---------------------------------------------------------------------------
// AppSidebar
// ---------------------------------------------------------------------------

/**
 * Vertical navigation sidebar scoped to a single app.
 *
 * Sticky below the h-14 AppHeader via `sticky top-14`. Hidden on mobile
 * (< md): a drawer-based mobile nav is deferred to a future sprint — the
 * horizontal tab bar has been removed so mobile users currently see only the
 * header + content with no sub-nav. This is a known UX gap for sprint-3.
 */
export function AppSidebar({ app, appId }: AppSidebarProps): React.JSX.Element {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  useTabShortcuts(appId)

  return (
    <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-border sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto bg-background">
      {/* Nav section */}
      <nav className="flex flex-col gap-0.5 p-2" aria-label="App navigation">
        {NAV_ITEMS.map((item) => {
          const resolved = item.to.replace("$id", appId)
          const isActive =
            pathname === resolved || pathname.startsWith(resolved + "/")
          const Icon = item.icon

          return (
            <Link
              key={item.label}
              to={item.to}
              params={{ id: appId }}
              className={[
                "group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              ].join(" ")}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon className="size-4 shrink-0" />
              <span className="flex-1">{item.label}</span>
              <span className="text-[10px] text-muted-foreground/40 font-mono group-hover:text-muted-foreground/60 transition-colors">
                {item.shortcut}
              </span>
            </Link>
          )
        })}
      </nav>

      {/* Divider */}
      <hr className="mx-3 border-border" />

      {/* Quick info section */}
      <div className="flex flex-col gap-3 p-3 pt-3">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
          Quick info
        </p>

        {/* Status */}
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">Status</span>
          <AppStatusBadge status={app.status} />
        </div>

        {/* Dynamic rows */}
        {buildQuickInfo(app).map((row) => (
          <div key={row.label} className="flex flex-col gap-0.5">
            <span className="text-[10px] text-muted-foreground">{row.label}</span>
            {row.href ? (
              <a
                href={row.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-foreground hover:underline truncate"
                title={row.title ?? row.value}
              >
                {row.label === "Branch" ? (
                  <span className="flex items-center gap-1">
                    <RiGitBranchLine className="size-3 shrink-0" />
                    {row.value}
                  </span>
                ) : (
                  row.value
                )}
              </a>
            ) : (
              <span
                className="text-xs text-foreground truncate flex items-center gap-1"
                title={row.title ?? row.value}
              >
                {row.label === "Branch" && (
                  <RiGitBranchLine className="size-3 shrink-0 text-muted-foreground" />
                )}
                {row.label === "Commit" && (
                  <RiGitCommitLine className="size-3 shrink-0 text-muted-foreground font-mono" />
                )}
                <span className={row.label === "Commit" ? "font-mono" : ""}>
                  {row.value}
                </span>
              </span>
            )}
          </div>
        ))}

        {/* Repo */}
        {app.repoFullName && (
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-muted-foreground">Repo</span>
            <span className="text-xs text-foreground truncate" title={app.repoFullName}>
              {app.repoFullName}
            </span>
          </div>
        )}
      </div>
    </aside>
  )
}
