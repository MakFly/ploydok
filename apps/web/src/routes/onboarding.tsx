// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Link, createFileRoute, redirect } from "@tanstack/react-router"
import {
  RiArrowRightLine,
  RiCheckboxCircleFill,
  RiGithubFill,
  RiGitlabFill,
  RiLock2Line,
} from "@remixicon/react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { requireMe } from "../lib/auth-guards"
import { getGitProviderStatus } from "../lib/git-providers"
import { organizationDashboardPath } from "../lib/organizations"
import { apiBaseUrl } from "../lib/api/base"
import type { GitProviderStatus } from "../lib/git-providers"
import type { Me } from "@ploydok/shared"

export const Route = createFileRoute("/onboarding")({
  beforeLoad: async (): Promise<{ me: Me; providers: GitProviderStatus }> => {
    const me = await requireMe()
    const providers = await getGitProviderStatus()
    if (providers.ready) {
      throw redirect({
        href: me.default_organization
          ? organizationDashboardPath(me.default_organization.slug)
          : "/dashboard",
      })
    }
    return { me, providers }
  },
  component: ProviderOnboardingPage,
})

function resolveApiHref(value?: string | null): string | null {
  if (!value) return null
  if (/^https?:\/\//.test(value)) return value
  const base = apiBaseUrl()
  if (/^https?:\/\//.test(base)) return new URL(value, base).toString()
  return `${base.replace(/\/$/, "")}/${value.replace(/^\//, "")}`
}

function ProviderOnboardingPage(): React.JSX.Element {
  const { me, providers } = Route.useRouteContext()

  return (
    <main className="min-h-dvh bg-[oklch(0.925_0.006_255)] p-4 text-foreground sm:p-8">
      <div className="mx-auto flex min-h-[calc(100dvh-2rem)] max-w-[1180px] flex-col overflow-hidden rounded-[24px] border border-black/5 bg-background shadow-[0_24px_80px_rgba(20,30,55,0.10)] sm:min-h-[calc(100dvh-4rem)] lg:grid lg:grid-cols-[0.82fr_1.18fr]">
        <section className="flex flex-col bg-[oklch(0.235_0.055_258)] p-7 text-[oklch(0.97_0.006_250)] sm:p-10 lg:p-12">
          <div className="flex items-center gap-2.5">
            <img
              src="/ploydok-mark.png"
              alt=""
              className="size-8 object-contain"
            />
            <span className="text-sm font-semibold">Ploydok</span>
          </div>
          <div className="my-auto py-16">
            <p className="font-mono text-xs tracking-[0.16em] text-[oklch(0.76_0.12_235)] uppercase">
              One step before deploy
            </p>
            <h1 className="mt-5 text-4xl leading-[1.02] font-semibold tracking-[-0.04em] sm:text-5xl">
              Connect your
              <br />
              source of truth.
            </h1>
            <p className="mt-6 max-w-md text-sm leading-7 text-white/62">
              Ploydok needs access to one Git provider before it can import a
              repository or create a Git-backed application.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-white/42">
            <RiLock2Line className="size-4" />
            Provider credentials are encrypted on this instance.
          </div>
        </section>

        <section className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-16 lg:py-16">
          <div className="mx-auto w-full max-w-[520px]">
            <p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">
              Welcome, {me.display_name}
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em]">
              Choose a Git provider
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Connect either provider to unlock the dashboard and project
              creation.
            </p>

            <div className="mt-9 space-y-3">
              <ProviderChoice
                name="GitHub"
                description="Install the Ploydok GitHub App on an account or organization."
                icon={RiGithubFill}
                configured={providers.github.configured}
                connected={providers.github.connected}
                href={resolveApiHref(providers.github.install_url)}
                settingsHref="/settings/git-providers/github"
                isAdmin={me.is_instance_admin}
              />
              <ProviderChoice
                name="GitLab"
                description="Authorize your GitLab account through the instance OAuth app."
                icon={RiGitlabFill}
                iconClassName="text-[#fc6d26]"
                configured={providers.gitlab.configured}
                connected={providers.gitlab.connected}
                href={resolveApiHref(providers.gitlab.connect_url)}
                settingsHref="/settings/git-providers/gitlab"
                isAdmin={me.is_instance_admin}
              />
            </div>

            {!providers.github.configured &&
            !providers.gitlab.configured &&
            !me.is_instance_admin ? (
              <p
                className="mt-6 rounded-[10px] bg-muted px-4 py-3 text-xs leading-5 text-muted-foreground"
                role="status"
              >
                An instance administrator must configure GitHub or GitLab before
                you can connect your account.
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  )
}

function ProviderChoice({
  name,
  description,
  icon: Icon,
  iconClassName,
  configured,
  connected,
  href,
  settingsHref,
  isAdmin,
}: {
  name: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  iconClassName?: string
  configured: boolean
  connected: boolean
  href: string | null
  settingsHref: string
  isAdmin: boolean
}): React.JSX.Element {
  return (
    <article className="rounded-[16px] border border-border bg-background p-4 shadow-[var(--shadow-xs)] transition-[border-color,box-shadow] duration-200 hover:border-foreground/20 hover:shadow-[var(--shadow-card)] sm:p-5">
      <div className="flex items-start gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-[12px] bg-muted">
          <Icon className={cn("size-5", iconClassName)} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold">{name}</h3>
            {connected ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                <RiCheckboxCircleFill className="size-4" /> Connected
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {description}
          </p>
          {!connected ? (
            <div className="mt-4">
              {configured && href ? (
                <Button asChild size="sm" className="gap-2">
                  <a href={href}>
                    Connect {name}
                    <RiArrowRightLine className="size-4" />
                  </a>
                </Button>
              ) : isAdmin ? (
                <Button asChild size="sm" variant="outline">
                  <Link to={settingsHref}>Configure {name}</Link>
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Waiting for instance setup
                </span>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  )
}
