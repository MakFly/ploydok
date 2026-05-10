// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import {
  RiArrowRightSLine,
  RiCheckboxCircleFill,
  RiCircleLine,
  RiGithubFill,
  RiGitlabFill,
} from "@remixicon/react"
import { cn } from "@workspace/ui/lib/utils"
import { ShellPage } from "../../../../components/layout/AppShell"
import { useGitHubAppConfig } from "../../../../lib/github"

export const Route = createFileRoute("/_authed/settings/git-providers/")({
  component: GitProvidersHub,
})

interface ProviderCardProps {
  slug: "github" | "gitlab"
  name: string
  status: "configured" | "not_configured" | "loading" | "coming_soon"
  description: string
  icon: React.ComponentType<{ className?: string }>
  accent: string
  note?: string
}

function GitProvidersHub(): React.JSX.Element {
  const github = useGitHubAppConfig()

  const providers: ReadonlyArray<ProviderCardProps> = [
    {
      slug: "github",
      name: "GitHub",
      description:
        "GitHub App — auto-deploy sur push, webhooks HMAC, accès par installation.",
      icon: RiGithubFill,
      accent: "text-foreground",
      status: github.isLoading
        ? "loading"
        : github.data?.configured
          ? "configured"
          : "not_configured",
      ...(github.data?.slug ? { note: `App: ${github.data.slug}` } : {}),
    },
    {
      slug: "gitlab",
      name: "GitLab",
      description:
        "OAuth2 per-user — gitlab.com ou instance self-hosted ; webhook X-Gitlab-Token.",
      icon: RiGitlabFill,
      accent: "text-[#fc6d26]",
      status: "coming_soon",
    },
  ]

  return (
    <ShellPage
      title="Git providers"
      description="Connecte les services d'hébergement Git pour déployer depuis un repo à chaque push."
    >
      <div className="space-y-6">
        <section aria-label="Providers" className="grid gap-3 md:grid-cols-2">
          {providers.map((p) => (
            <ProviderCard key={p.slug} {...p} />
          ))}
        </section>
      </div>
    </ShellPage>
  )
}

function ProviderCard({
  slug,
  name,
  status,
  description,
  icon: Icon,
  accent,
  note,
}: ProviderCardProps): React.JSX.Element {
  const disabled = status === "coming_soon"
  const inner = (
    <>
      <div className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-md border border-border bg-background">
          <Icon className={cn("size-6", accent)} />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <p className="text-base font-medium">{name}</p>
            <StatusBadge status={status} />
          </div>
          {note ? (
            <p className="font-mono text-[10px] tracking-wide text-muted-foreground">
              {note}
            </p>
          ) : null}
        </div>
        {!disabled && (
          <RiArrowRightSLine className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        )}
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </>
  )

  if (disabled) {
    return (
      <div
        aria-disabled
        title="Coming soon"
        className="flex cursor-not-allowed flex-col gap-4 rounded-xl border border-border bg-card p-5 opacity-60"
      >
        {inner}
      </div>
    )
  }

  return (
    <Link
      to="/settings/git-providers/$slug"
      params={{ slug }}
      className="group flex flex-col gap-4 rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40"
    >
      {inner}
    </Link>
  )
}

function StatusBadge({
  status,
}: {
  status: "configured" | "not_configured" | "loading" | "coming_soon"
}): React.JSX.Element {
  if (status === "coming_soon") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
        Coming soon
      </span>
    )
  }
  if (status === "loading") {
    return (
      <span className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
        …
      </span>
    )
  }
  if (status === "configured") {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[10px] tracking-wide text-emerald-600 uppercase dark:text-emerald-400">
        <RiCheckboxCircleFill className="size-3" />
        Configured
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
      <RiCircleLine className="size-3" />
      Not set
    </span>
  )
}
