// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Link } from "@tanstack/react-router"
import { RiArrowRightUpLine } from "@remixicon/react"
import { ShellPanel } from "../layout/AppShell"

export function GettingStartedPanel({
  githubConnected,
  onCreateApp,
}: {
  githubConnected: boolean
  onCreateApp: () => void
}): React.JSX.Element {
  return (
    <ShellPanel title="Get started" description="Les premières étapes utiles.">
      <div className="space-y-2">
        <MiniStep
          label="Connect GitHub"
          body={
            githubConnected
              ? "GitHub App is already configured."
              : "Install the GitHub App to unlock repository selection."
          }
          to="/settings/git-providers/$slug"
          params={{ slug: "github" }}
        />
        <MiniButton
          label="Create a new app"
          body="Open the modal and start from a repository or template."
          onClick={onCreateApp}
        />
        <MiniStep
          label="Review the guide"
          body="Operational notes for app setup and callback flow."
          to="/guide"
        />
      </div>
    </ShellPanel>
  )
}

const miniItemClass =
  "group flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-panel-border bg-panel-inset px-4 py-3 text-left shadow-sm transition-colors outline-none hover:border-muted-foreground/30 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"

function MiniItemContent({
  label,
  body,
}: {
  label: string
  body: string
}): React.JSX.Element {
  return (
    <>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">
          {label}
        </span>
        <span className="block text-xs leading-5 text-muted-foreground">
          {body}
        </span>
      </span>
      <RiArrowRightUpLine className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
    </>
  )
}

export function MiniStep({
  label,
  body,
  to,
  params,
}: {
  label: string
  body: string
  to: string
  params?: Record<string, string>
}): React.JSX.Element {
  const linkProps = { to, ...(params ? { params } : {}) } as Parameters<
    typeof Link
  >[0]
  return (
    <Link {...linkProps} className={miniItemClass}>
      <MiniItemContent label={label} body={body} />
    </Link>
  )
}

export function MiniButton({
  label,
  body,
  onClick,
}: {
  label: string
  body: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button type="button" onClick={onClick} className={miniItemClass}>
      <MiniItemContent label={label} body={body} />
    </button>
  )
}
