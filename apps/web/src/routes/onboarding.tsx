// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import {
  RiArrowRightLine,
  RiBox3Line,
  RiCheckLine,
  RiGithubFill,
  RiGitlabFill,
  RiLock2Line,
  RiRefreshLine,
} from "@remixicon/react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"
import {
  ChoiceCard,
  OnboardingStepShell,
  StepFooter,
  StepHeading,
} from "../components/onboarding/OnboardingStepShell"
import { GitHubAppSetupCard } from "../components/settings/providers/GitHubAppSetupCard"
import {
  GitLabConfigForm,
  GitLabSetupHelp,
} from "../components/settings/providers/GitLabConfigForm"
import { requireMe } from "../lib/auth-guards"
import { useLogout } from "../lib/auth"
import { apiFetch } from "../lib/api"
import {
  getGitProviderStatus,
  useGitProviderStatus,
} from "../lib/git-providers"
import { useCreateGitHubAppFlow } from "../lib/github"
import { usePendingAction } from "../lib/hooks/use-pending-action"
import {
  gitLabOAuthErrorMessage,
  gitlabConnectUrl,
  useGitLabConfig,
  useSaveGitLabConfig,
} from "../lib/gitlab"
import { useRenameOrganization } from "../lib/organizations"
import {
  onboardingDashboardHref,
  rememberOnboardingDeploymentSource,
} from "../lib/onboarding"
import { apiBaseUrl } from "../lib/api/base"
import type { GitProviderStatus } from "../lib/git-providers"
import type { OnboardingDeploymentSource } from "../lib/onboarding"
import type { Me } from "@ploydok/shared"

/** Every external round-trip started here is told to come back to this path. */
const RETURN_TO = "/onboarding"

type ProviderKey = "github" | "gitlab"

export const Route = createFileRoute("/onboarding")({
  beforeLoad: async (): Promise<{ me: Me; providers: GitProviderStatus }> => {
    const me = await requireMe()
    const providers = await getGitProviderStatus()
    return { me, providers }
  },
  component: OnboardingPage,
})

function resolveApiHref(
  value: string | null | undefined,
  returnTo: string
): string | null {
  if (!value) return null
  const base = apiBaseUrl()
  const absolute = /^https?:\/\//.test(value)
    ? new URL(value)
    : /^https?:\/\//.test(base)
      ? new URL(value, base)
      : null
  if (!absolute) {
    const joined = `${base.replace(/\/$/, "")}/${value.replace(/^\//, "")}`
    return `${joined}?return_to=${encodeURIComponent(returnTo)}`
  }
  absolute.searchParams.set("return_to", returnTo)
  return absolute.toString()
}

function OnboardingPage(): React.JSX.Element {
  const { me, providers: initialProviders } = Route.useRouteContext()
  const router = useRouter()
  const logout = useLogout()
  const statusQuery = useGitProviderStatus()
  const providers = statusQuery.data ?? initialProviders
  const [deploymentSource, setDeploymentSource] =
    React.useState<OnboardingDeploymentSource | null>(() => {
      if (typeof window === "undefined") return null
      const source = new URLSearchParams(window.location.search).get("source")
      return source === "github" || source === "gitlab" ? source : null
    })
  const oauthError =
    typeof window !== "undefined"
      ? gitLabOAuthErrorMessage(window.location.search)
      : null

  const connected = providers.github.connected || providers.gitlab.connected

  const refreshProviderStatus =
    React.useCallback(async (): Promise<GitProviderStatus> => {
      const result = await statusQuery.refetch()
      if (result.error) throw result.error
      if (!result.data) throw new Error("Provider status is unavailable")
      return result.data
    }, [statusQuery])

  const onLogout = React.useCallback(() => {
    void logout.mutateAsync().finally(() => {
      void router.navigate({ to: "/login" })
    })
  }, [logout, router])

  if (connected || deploymentSource === "image") {
    const source =
      deploymentSource ??
      (providers.gitlab.connected && !providers.github.connected
        ? "gitlab"
        : "github")
    return <ProjectStep me={me} source={source} onLogout={onLogout} />
  }
  return (
    <ProviderStep
      me={me}
      providers={providers}
      onRefreshStatus={refreshProviderStatus}
      refreshing={statusQuery.isFetching}
      oauthError={oauthError}
      onUseImage={() => setDeploymentSource("image")}
      onLogout={onLogout}
    />
  )
}

// ---------------------------------------------------------------------------
// Step 1 — Git provider
// ---------------------------------------------------------------------------

function ProviderStep({
  me,
  providers,
  onRefreshStatus,
  refreshing,
  oauthError,
  onUseImage,
  onLogout,
}: {
  me: Me
  providers: GitProviderStatus
  onRefreshStatus: () => Promise<GitProviderStatus>
  refreshing: boolean
  oauthError: string | null
  onUseImage: () => void
  onLogout: () => void
}): React.JSX.Element {
  // Derived from the server on first render: when exactly one provider is
  // already configured, the choice has effectively been made for the user.
  const preselected: ProviderKey | null = providers.github.configured
    ? providers.gitlab.configured
      ? null
      : "github"
    : providers.gitlab.configured
      ? "gitlab"
      : null
  const [selected, setSelected] = React.useState<ProviderKey | null>(
    preselected
  )
  const [checkError, setCheckError] = React.useState<string | null>(null)
  const [checking, setChecking] = React.useState(false)

  if (selected === null) {
    return (
      <OnboardingStepShell activeStep="provider" onLogout={onLogout}>
        <div className="flex flex-col gap-8">
          {oauthError ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {oauthError}
            </div>
          ) : null}
          <StepHeading
            title={`Welcome, ${me.display_name}.`}
            description="Connect a Git provider to import a repository, or continue with an existing OCI image. You can configure another source later."
          />

          <fieldset>
            <legend className="text-sm font-medium">
              Choose a deployment source
            </legend>
            <p className="mt-1 text-sm text-muted-foreground">
              Everything happens here. You stay in this wizard through the whole
              setup.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <ProviderChoice
                name="GitHub"
                maturity="Beta"
                description="Install the Ploydok GitHub App on an account or organization."
                icon={RiGithubFill}
                configured={providers.github.configured}
                onSelect={() => setSelected("github")}
              />
              <ProviderChoice
                name="GitLab"
                maturity="Beta"
                description="Authorize your GitLab account through the instance OAuth app."
                icon={RiGitlabFill}
                iconClassName="text-[#fc6d26]"
                configured={providers.gitlab.configured}
                onSelect={() => setSelected("gitlab")}
              />
              <ProviderChoice
                name="Docker / OCI image"
                maturity="Beta"
                description="Deploy an existing public or private container image without connecting Git."
                icon={RiBox3Line}
                status="No Git provider required"
                onSelect={onUseImage}
              />
            </div>
          </fieldset>
        </div>

        <StepFooter hint="Pick one source to continue. Git providers stay available in settings.">
          <EncryptionNote />
        </StepFooter>
      </OnboardingStepShell>
    )
  }

  const provider = providers[selected]
  const back = (): void => setSelected(null)

  if (!provider.configured) {
    return (
      <OnboardingStepShell
        activeStep="provider"
        onBack={back}
        onLogout={onLogout}
      >
        <div className="flex flex-col gap-8">
          {oauthError ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {oauthError}
            </div>
          ) : null}
          <StepHeading
            title={
              selected === "github"
                ? "Set up the GitHub App"
                : "Set up the GitLab OAuth app"
            }
            description="This is an instance-wide setup, done once. Everyone on this Ploydok will connect through it."
          />
          {me.is_instance_admin ? (
            selected === "github" ? (
              <GitHubSetupStep onConfigured={onRefreshStatus} />
            ) : (
              <GitLabSetupStep onConfigured={onRefreshStatus} />
            )
          ) : (
            <WaitingForAdmin
              onRefresh={onRefreshStatus}
              refreshing={refreshing}
            />
          )}
        </div>

        <StepFooter
          hint={
            me.is_instance_admin
              ? "Once saved, you will come straight back here to connect your account."
              : "This screen updates as soon as an administrator finishes the setup."
          }
        >
          <EncryptionNote />
        </StepFooter>
      </OnboardingStepShell>
    )
  }

  const href =
    selected === "github"
      ? resolveApiHref(providers.github.install_url, RETURN_TO)
      : gitlabConnectUrl({ returnTo: RETURN_TO })

  const handleCheckAgain = async (): Promise<void> => {
    setCheckError(null)
    setChecking(true)
    try {
      if (selected === "github") {
        await apiFetch("/github/installations/reconnect", { method: "POST" })
      }
      const refreshed = await onRefreshStatus()
      if (!refreshed[selected].connected) {
        throw new Error("The provider is configured but not connected yet")
      }
    } catch (error) {
      setCheckError(
        error instanceof Error
          ? error.message
          : "Unable to verify the provider connection"
      )
    } finally {
      setChecking(false)
    }
  }

  return (
    <OnboardingStepShell
      activeStep="provider"
      onBack={back}
      onLogout={onLogout}
    >
      <div className="flex flex-col gap-8">
        {oauthError ? (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {oauthError}
          </div>
        ) : null}
        <StepHeading
          title={
            selected === "github"
              ? "Connect your GitHub account"
              : "Connect your GitLab account"
          }
          description={
            selected === "github"
              ? "Install the Ploydok GitHub App on the account or organization holding the repositories you want to deploy."
              : "Authorize Ploydok on your GitLab account so it can list your projects and read your repositories."
          }
        />

        <div className="flex flex-col gap-3">
          {/* A real navigation: the API sets a signed state cookie, then 302s
              to the provider. Going through fetch would silently follow it. */}
          <Button asChild size="sm" className="w-fit gap-2" disabled={!href}>
            <a href={href ?? "#"}>
              {selected === "github"
                ? "Install on GitHub"
                : "Authorize on GitLab"}
              <RiArrowRightLine className="size-4" />
            </a>
          </Button>
          <p className="text-xs leading-5 text-muted-foreground">
            You will be sent to{" "}
            {selected === "github" ? "github.com" : "gitlab.com"} and returned
            to this page automatically.
          </p>
        </div>
      </div>

      <StepFooter hint="Already installed? We check the link and reopen GitHub only if confirmation is still needed.">
        {checkError ? (
          <p className="text-sm text-destructive" role="alert">
            {checkError}
          </p>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit gap-2"
          onClick={() => void handleCheckAgain()}
          loading={checking || refreshing}
        >
          {!checking && !refreshing && <RiRefreshLine className="size-3.5" />}
          {checking || refreshing ? "Checking…" : "Check again"}
        </Button>
        <EncryptionNote />
      </StepFooter>
    </OnboardingStepShell>
  )
}

function GitHubSetupStep({
  onConfigured,
}: {
  onConfigured: () => void | Promise<GitProviderStatus>
}): React.JSX.Element {
  const createApp = useCreateGitHubAppFlow(RETURN_TO)

  return (
    <div className="rounded-2xl bg-panel p-5">
      <GitHubAppSetupCard
        isPending={createApp.isPending}
        onCreate={() => void createApp.start()}
        onImported={onConfigured}
        error={createApp.error}
      />
    </div>
  )
}

function GitLabSetupStep({
  onConfigured,
}: {
  onConfigured: () => void | Promise<GitProviderStatus>
}): React.JSX.Element {
  const { data: config } = useGitLabConfig()
  const save = useSaveGitLabConfig()

  return (
    <div className="flex flex-col gap-3">
      <GitLabConfigForm
        onSave={async (values) => {
          await save.mutateAsync(values)
          onConfigured()
        }}
        pending={save.isPending}
      />
      <GitLabSetupHelp callbackUrl={config?.callback_url} />
    </div>
  )
}

function WaitingForAdmin({
  onRefresh,
  refreshing,
}: {
  onRefresh: () => void | Promise<GitProviderStatus>
  refreshing: boolean
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-start gap-3 rounded-2xl bg-panel p-5">
      <p className="text-sm">
        An instance administrator has to register this provider before you can
        connect your account.
      </p>
      <p className="text-xs leading-5 text-muted-foreground">
        Nothing is lost. Come back to this page once they are done, or check
        again now.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={onRefresh}
        loading={refreshing}
      >
        {!refreshing && <RiRefreshLine className="size-3.5" />}
        {refreshing ? "Checking…" : "Check again"}
      </Button>
    </div>
  )
}

function ProviderChoice({
  name,
  maturity,
  description,
  icon: Icon,
  iconClassName,
  configured,
  status,
  onSelect,
}: {
  name: string
  maturity: "Beta"
  description: string
  icon: React.ComponentType<{ className?: string }>
  iconClassName?: string
  configured?: boolean
  status?: string
  onSelect: () => void
}): React.JSX.Element {
  return (
    <ChoiceCard selected={false} className="items-start gap-3 p-0">
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon
          aria-hidden
          className={cn(
            "mt-0.5 size-4 shrink-0 text-muted-foreground",
            iconClassName
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-sm font-medium">
            {name}
            <span className="rounded-full border border-border px-1.5 py-0.5 font-mono text-[9px] tracking-wide text-muted-foreground uppercase">
              {maturity}
            </span>
          </span>
          <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
            {description}
          </span>
          <span className="mt-1.5 block text-xs text-muted-foreground">
            {status ??
              (configured ? "Ready to connect" : "Needs instance setup first")}
          </span>
        </span>
        <RiArrowRightLine
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        />
      </button>
    </ChoiceCard>
  )
}

// ---------------------------------------------------------------------------
// Step 2 — Name the workspace
// ---------------------------------------------------------------------------

/** Mirrors slugifyOrganizationName on the API so the preview does not lie. */
function previewSlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
  return slug || "workspace"
}

function ProjectStep({
  me,
  source,
  onLogout,
}: {
  me: Me
  source: OnboardingDeploymentSource
  onLogout: () => void
}): React.JSX.Element {
  const router = useRouter()
  const organization = me.default_organization
  const rename = useRenameOrganization()
  const [name, setName] = React.useState(organization?.name ?? "")

  const goToDashboard = React.useCallback(
    async (slug: string | undefined): Promise<void> => {
      rememberOnboardingDeploymentSource(me.id, source)
      await router.navigate({
        href: onboardingDashboardHref(slug, source),
      })
    },
    [me.id, router, source]
  )

  const trimmed = name.trim()
  const unchanged = trimmed === (organization?.name ?? "")

  // Both paths end in a navigation, so the pending flag has to cover it. The
  // no-rename path has no mutation at all: without this it navigates with zero
  // feedback.
  const submit = usePendingAction(async () => {
    if (!organization || unchanged) {
      await goToDashboard(organization?.slug)
      return
    }
    const result = await rename.mutateAsync({
      slug: organization.slug,
      name: trimmed,
      reslug: true,
    })
    await goToDashboard(result.organization.slug)
  })
  const skip = usePendingAction(() => goToDashboard(organization?.slug))
  const busy = submit.pending || skip.pending
  const canSubmit = trimmed.length > 0 && !busy

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault()
    try {
      await submit.run()
    } catch {
      // rename.error carries the message.
    }
  }

  return (
    <OnboardingStepShell activeStep="project" onLogout={onLogout}>
      <form
        className="flex flex-col"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <div className="flex flex-col gap-8">
          <StepHeading
            title="Name your workspace."
            description="A workspace groups your applications, databases and domains. Ploydok already created one for you, so this only renames it."
          />

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="workspace-name">
              Workspace name
            </label>
            <Input
              id="workspace-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Acme"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              URL:{" "}
              <code className="font-mono">
                /orgs/
                {unchanged
                  ? (organization?.slug ?? "workspace")
                  : previewSlug(trimmed)}
              </code>
            </p>
            {rename.error ? (
              <p className="text-sm text-destructive" role="alert">
                {rename.error.message}
              </p>
            ) : null}
          </div>

          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <RiCheckLine aria-hidden className="size-3.5" />
            {source === "image"
              ? "OCI image deployment selected."
              : `${source === "gitlab" ? "GitLab" : "GitHub"} connected.`}
          </p>
        </div>

        <StepFooter hint="You can rename it later, and create more workspaces from the sidebar.">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              size="sm"
              loading={submit.pending}
              disabled={!canSubmit}
            >
              {submit.pending ? "Saving…" : "Continue"}
              {!submit.pending && <RiArrowRightLine className="size-4" />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void skip.run()}
              loading={skip.pending}
              disabled={submit.pending}
            >
              Skip
            </Button>
          </div>
        </StepFooter>
      </form>
    </OnboardingStepShell>
  )
}

function EncryptionNote(): React.JSX.Element {
  return (
    <p className="flex items-center gap-2 text-xs text-muted-foreground">
      <RiLock2Line aria-hidden className="size-3.5" />
      Provider credentials are encrypted on this instance.
    </p>
  )
}
