// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute, notFound } from "@tanstack/react-router"
import {
  RiCheckboxCircleFill,
  RiCircleLine,
  RiGithubFill,
  RiGitlabFill,
} from "@remixicon/react"
import { ShellPage } from "../../../../components/layout/AppShell"
import { GitHubPanel } from "../../../../components/settings/providers/GitHubPanel"
import { useGitHubAppConfig } from "../../../../lib/github"

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
    <ShellPage title={provider.title} description={provider.description}>
      <div className="space-y-6">
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
        {slug === "gitlab" ? <ComingSoonPanel /> : null}
      </div>
    </ShellPage>
  )
}

function ComingSoonPanel(): React.JSX.Element {
  return (
    <section
      aria-label="Coming soon"
      className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/40 p-10 text-center"
    >
      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
        Coming soon
      </span>
      <p className="text-sm font-medium">L'intégration GitLab arrive bientôt</p>
      <p className="max-w-md text-xs text-muted-foreground">
        En attendant, utilise GitHub ou un déploiement par image OCI. Tu peux
        suivre l'avancement sur la roadmap.
      </p>
    </section>
  )
}

function ProviderStatusBadge({
  slug,
}: {
  slug: ProviderSlug
}): React.JSX.Element {
  const github = useGitHubAppConfig()

  if (slug === "gitlab") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
        Coming soon
      </span>
    )
  }

  if (github.isLoading) {
    return (
      <span className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
        …
      </span>
    )
  }
  return github.data?.configured ? (
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
