// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Link, createFileRoute, notFound } from "@tanstack/react-router"
import {
  RiArrowLeftLine,
  RiCheckboxCircleFill,
  RiCircleLine,
  RiGithubFill,
  RiGitlabFill,
} from "@remixicon/react"
import { ShellPage } from "../../../../components/layout/AppShell"
import { SettingsTabs } from "../../../../components/settings/SettingsTabs"
import { GitHubPanel } from "../../../../components/settings/providers/GitHubPanel"
import { GitLabPanel } from "../../../../components/settings/providers/GitLabPanel"
import { useGitHubAppConfig } from "../../../../lib/github"
import { useGitLabConfig } from "../../../../lib/gitlab"

type ProviderSlug = "github" | "gitlab"

interface ProviderMeta {
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  accent: string
}

const PROVIDERS: Record<ProviderSlug, ProviderMeta> = {
  github: {
    title: "GitHub",
    description:
      "GitHub App — auto-deploy sur push, webhooks HMAC, accès par installation.",
    icon: RiGithubFill,
    accent: "text-foreground",
  },
  gitlab: {
    title: "GitLab",
    description:
      "OAuth2 per-user. gitlab.com ou instance self-hosted. Webhook vérifié via X-Gitlab-Token.",
    icon: RiGitlabFill,
    accent: "text-[#fc6d26]",
  },
}

function isSlug(v: string): v is ProviderSlug {
  return v === "github" || v === "gitlab"
}

export const Route = createFileRoute("/_authed/settings/git-providers/$slug")({
  beforeLoad: ({ params }) => {
    if (!isSlug(params.slug)) {
      throw notFound()
    }
  },
  component: ProviderDashboard,
})

function ProviderDashboard(): React.JSX.Element {
  const { slug } = Route.useParams()
  const provider = PROVIDERS[slug as ProviderSlug]
  const Icon = provider.icon

  return (
    <ShellPage
      title={provider.title}
      description={provider.description}
      eyebrow="Settings · Git providers"
    >
      <div className="space-y-6">
        <SettingsTabs />

        <BackLink />

        <section
          aria-label="Provider header"
          className="flex items-center gap-3 rounded-xl border border-border bg-card p-4"
        >
          <div className="flex size-11 items-center justify-center rounded-md border border-border bg-background">
            <Icon className={`size-5 ${provider.accent}`} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{provider.title}</p>
            <p className="truncate text-xs text-muted-foreground">
              {provider.description}
            </p>
          </div>
          <ProviderStatusBadge slug={slug as ProviderSlug} />
        </section>

        {slug === "github" ? <GitHubPanel /> : null}
        {slug === "gitlab" ? <GitLabPanel /> : null}
      </div>
    </ShellPage>
  )
}

function BackLink(): React.JSX.Element {
  return (
    <Link
      to="/settings/git-providers"
      className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
    >
      <RiArrowLeftLine className="size-3.5" />
      Git providers
    </Link>
  )
}

function ProviderStatusBadge({
  slug,
}: {
  slug: ProviderSlug
}): React.JSX.Element {
  const github = useGitHubAppConfig()
  const gitlab = useGitLabConfig()
  const configured =
    slug === "github" ? Boolean(github.data?.configured) : Boolean(gitlab.data?.configured)
  const loading = slug === "github" ? github.isLoading : gitlab.isLoading

  if (loading) {
    return (
      <span className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
        …
      </span>
    )
  }
  return configured ? (
    <span className="inline-flex items-center gap-1 font-mono text-[10px] tracking-wide text-emerald-600 uppercase dark:text-emerald-400">
      <RiCheckboxCircleFill className="size-3" />
      Configured
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
      <RiCircleLine className="size-3" />
      Not set
    </span>
  )
}
