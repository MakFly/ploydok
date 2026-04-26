// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import {
  RiFlashlightLine,
  RiGitBranchLine,
  RiTimerFlashLine,
} from "@remixicon/react"

const CDN_ITEMS = [
  {
    icon: RiFlashlightLine,
    label: "Internal edge cache",
    value: "Planned",
  },
  {
    icon: RiTimerFlashLine,
    label: "Compression and TTL rules",
    value: "Sprint 7",
  },
  {
    icon: RiGitBranchLine,
    label: "External provider handoff",
    value: "Not wired",
  },
]

export function CdnSection({ appId }: { appId: string }): React.JSX.Element {
  return (
    <div
      className="rounded-lg border border-border bg-card"
      data-app-id={appId}
      aria-label="CDN configuration status"
    >
      <div className="flex flex-col gap-1 border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium">CDN is not active for this app</p>
          <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            Off
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          The app is currently served directly through Caddy routing. CDN
          controls are scheduled for the dedicated CDN sprint.
        </p>
      </div>

      <div className="grid gap-px bg-border sm:grid-cols-3">
        {CDN_ITEMS.map((item) => {
          const Icon = item.icon
          return (
            <div key={item.label} className="bg-card px-4 py-3">
              <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-md border border-border bg-muted">
                <Icon
                  className="size-4 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
              <p className="text-xs font-medium">{item.label}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {item.value}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
