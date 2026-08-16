// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import {
  Link,
  createFileRoute,
  redirect,
  useRouter,
} from "@tanstack/react-router"
import {
  RiArrowRightLine,
  RiCheckLine,
  RiGithubFill,
  RiGitlabFill,
  RiLock2Line,
} from "@remixicon/react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import {
  ChoiceCard,
  OnboardingStepShell,
  StepFooter,
  StepHeading,
} from "../components/onboarding/OnboardingStepShell"
import { requireMe } from "../lib/auth-guards"
import { useLogout } from "../lib/auth"
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
  const router = useRouter()
  const logout = useLogout()

  const nothingConfigured =
    !providers.github.configured && !providers.gitlab.configured
  const connected = providers.github.connected || providers.gitlab.connected

  return (
    <OnboardingStepShell
      activeStep="provider"
      onLogout={() => {
        void logout.mutateAsync().finally(() => {
          void router.navigate({ to: "/login" })
        })
      }}
    >
      <div className="flex flex-col gap-8 pt-2 sm:pt-6">
        <StepHeading
          title={`Welcome, ${me.display_name}.`}
          description="Ploydok needs access to one Git provider before it can import a repository or create a Git-backed application. You can connect the other one later."
        />

        <fieldset>
          <legend className="text-sm font-medium">Choose a Git provider</legend>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect either provider to unlock the dashboard and project
            creation.
          </p>
          <div className="mt-3 flex flex-col gap-2">
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
        </fieldset>
      </div>

      <StepFooter
        hint={
          connected
            ? "Looks good. Finish the provider setup to continue."
            : "Pick one provider to continue. The other stays available in settings."
        }
      >
        {nothingConfigured && !me.is_instance_admin ? (
          <p
            className="rounded-lg bg-muted px-4 py-3 text-xs leading-5 text-muted-foreground"
            role="status"
          >
            An instance administrator must configure GitHub or GitLab before you
            can connect your account.
          </p>
        ) : null}
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <RiLock2Line aria-hidden className="size-3.5" />
          Provider credentials are encrypted on this instance.
        </p>
      </StepFooter>
    </OnboardingStepShell>
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
    <ChoiceCard selected={connected} className="items-start gap-3 px-3 py-3">
      <Icon
        aria-hidden
        className={cn(
          "mt-0.5 size-4 shrink-0 text-muted-foreground",
          connected && "text-foreground",
          iconClassName
        )}
      />
      <div className="min-w-0 flex-1">
        <span className="text-sm font-medium">{name}</span>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
          {description}
        </p>
        {!connected ? (
          <div className="mt-3">
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
      <span
        aria-hidden
        data-slot="selection-check"
        className="mt-0.5 ml-auto grid size-3.5 shrink-0 place-items-center"
      >
        <RiCheckLine
          className={cn("size-3.5", connected ? "opacity-100" : "opacity-0")}
        />
      </span>
    </ChoiceCard>
  )
}
