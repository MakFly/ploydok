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
      <div className="space-y-3">
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
    <Link
      {...linkProps}
      className="flex items-center justify-between rounded-md border border-border bg-card px-4 py-3 transition-colors hover:bg-accent/40"
    >
      <span>
        <span className="block text-sm font-medium text-foreground">
          {label}
        </span>
        <span className="block text-xs text-muted-foreground">{body}</span>
      </span>
      <RiArrowRightUpLine className="size-4 text-muted-foreground" />
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
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-md border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-accent/40"
    >
      <span>
        <span className="block text-sm font-medium text-foreground">
          {label}
        </span>
        <span className="block text-xs text-muted-foreground">{body}</span>
      </span>
      <RiArrowRightUpLine className="size-4 text-muted-foreground" />
    </button>
  )
}
