// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { AppStatusBadge } from "./AppStatusBadge"
import { DeployButton } from "./DeployButton"
import { ActionsMenu } from "./ActionsMenu"
import type { AppDetail } from "../../lib/apps"

// ---------------------------------------------------------------------------
// AppHeader
// Sticky fullwidth header — h-14 so AppSidebar can sticky to top-14.
// No max-width constraint: sidebar + content handle their own layout.
// ---------------------------------------------------------------------------

interface AppHeaderProps {
  app: AppDetail
}

export function AppHeader({ app }: AppHeaderProps): React.JSX.Element {
  return (
    <div className="sticky top-0 z-30 h-14 backdrop-blur bg-background/80 border-b border-border">
      <div className="flex h-full w-full items-center justify-between gap-4 px-4">
        <div className="min-w-0 flex items-center gap-3">
          {/* App name */}
          <h1 className="text-sm font-semibold truncate shrink-0">{app.name}</h1>

          {/* Status badge */}
          <AppStatusBadge status={app.status} />

          {/* Separator + domain */}
          {app.domain && (
            <>
              <span
                aria-hidden="true"
                className="hidden md:block text-muted-foreground/50 shrink-0"
              >
                ·
              </span>
              <a
                href={`https://${app.domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hidden md:flex items-center gap-1 text-xs text-muted-foreground min-w-0 transition-colors hover:text-foreground hover:underline"
                title={app.domain}
              >
                <GlobeIcon className="size-3 shrink-0" />
                <span className="truncate">{app.domain}</span>
              </a>
            </>
          )}
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-2 shrink-0">
          <DeployButton appId={app.id} />
          <ActionsMenu app={app} />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function GlobeIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </svg>
  )
}
