// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import {
  RiCheckboxCircleLine,
  RiCloseCircleLine,
  RiErrorWarningLine,
  RiLoader4Line,
} from "@remixicon/react"
import {
  createFileRoute,
  useNavigate,
  useParams,
  useRouterState,
  useSearch,
} from "@tanstack/react-router"
import { Separator } from "@workspace/ui/components/separator"
import { DeploymentsTable } from "../../../../../../components/apps/DeploymentsTable"
import { BuildLogDrawer } from "../../../../../../components/apps/BuildLogDrawer"
import { DeploymentTriggers } from "../../../../../../components/apps/DeploymentTriggers"
import { WebhooksPanel } from "../../../../../../components/apps/WebhooksPanel"
import { AppBuildRuntimeSettings } from "../../../../../../components/apps/AppBuildRuntimeSettings"
import { useApp, useBuilds } from "../../../../../../lib/apps"
import {
  useCancelBuild,
  useRollbackApp,
} from "../../../../../../lib/apps-mutations"
import {
  useEventsConnected,
  useEventsSubscription,
} from "../../../../../../lib/events-provider"
import type { Build } from "@ploydok/shared"
import type { BuildStatusEventPayload } from "../../../../../../lib/apps"

interface DeploymentsSearch {
  build?: string
}

type DeploymentLiveEventType =
  | "build.started"
  | "build.succeeded"
  | "build.failed"
  | "build.cancelled"
  | "deploy.status_change"

interface DeploymentLiveEvent {
  type: DeploymentLiveEventType
  message: string
  t: number
}

const LIVE_EVENT_LABELS: Record<DeploymentLiveEventType, string> = {
  "build.started": "Build started",
  "build.succeeded": "Build succeeded",
  "build.failed": "Build failed",
  "build.cancelled": "Build cancelled",
  "deploy.status_change": "Deployment updated",
}

function validateDeploymentsSearch(
  search: Record<string, unknown>
): DeploymentsSearch {
  return {
    build: typeof search["build"] === "string" ? search["build"] : undefined,
  }
}

function useDeploymentLiveEvent(appId: string): DeploymentLiveEvent | null {
  const [latest, setLatest] = React.useState<DeploymentLiveEvent | null>(null)

  React.useEffect(() => {
    setLatest(null)
  }, [appId])

  const handleEvent = React.useCallback(
    (type: DeploymentLiveEventType) => (payload: BuildStatusEventPayload) => {
      if (payload.appId !== appId) return
      setLatest({
        type,
        message: payload.message ?? LIVE_EVENT_LABELS[type],
        t: typeof payload.t === "number" ? payload.t : Date.now(),
      })
    },
    [appId]
  )

  useEventsSubscription<BuildStatusEventPayload>(
    "build.started",
    handleEvent("build.started")
  )
  useEventsSubscription<BuildStatusEventPayload>(
    "deploy.status_change",
    handleEvent("deploy.status_change")
  )
  useEventsSubscription<BuildStatusEventPayload>(
    "build.succeeded",
    handleEvent("build.succeeded")
  )
  useEventsSubscription<BuildStatusEventPayload>(
    "build.failed",
    handleEvent("build.failed")
  )
  useEventsSubscription<BuildStatusEventPayload>(
    "build.cancelled",
    handleEvent("build.cancelled")
  )

  return latest
}

function DeploymentLiveBanner({ appId }: { appId: string }): React.JSX.Element {
  const connected = useEventsConnected()
  const latest = useDeploymentLiveEvent(appId)
  const isTerminal =
    latest?.type === "build.succeeded" ||
    latest?.type === "build.failed" ||
    latest?.type === "build.cancelled"
  const isError =
    latest?.type === "build.failed" || latest?.type === "build.cancelled"
  const Icon = isTerminal
    ? isError
      ? RiCloseCircleLine
      : RiCheckboxCircleLine
    : RiLoader4Line

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
      aria-live="polite"
    >
      <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
        <span
          className={[
            "size-2 rounded-full",
            connected ? "bg-emerald-500" : "bg-amber-500",
          ].join(" ")}
          aria-hidden
        />
        {connected ? "Live connected" : "Live reconnecting"}
      </span>
      {latest ? (
        <>
          <span aria-hidden>|</span>
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <Icon
              className={[
                "size-3.5 shrink-0",
                !isTerminal ? "animate-spin" : "",
                isError ? "text-destructive" : "",
                latest.type === "build.succeeded" ? "text-emerald-500" : "",
              ].join(" ")}
              aria-hidden
            />
            <span className="truncate">{latest.message}</span>
          </span>
        </>
      ) : null}
    </div>
  )
}

function AppDeploymentsTab(): React.JSX.Element {
  const { id: routeAppId } = useParams({ strict: false })
  const appId = routeAppId!
  const { build: selectedBuildId } = useSearch({
    strict: false,
  })
  const navigate = useNavigate()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  const { data: builds, isLoading, error } = useBuilds(appId)
  const { data: app } = useApp(appId)
  const rollback = useRollbackApp(appId)
  const cancelBuild = useCancelBuild(appId)

  const selectedBuild = React.useMemo(
    () => builds?.find((b) => b.id === selectedBuildId),
    [builds, selectedBuildId]
  )
  const selectedFailure =
    selectedBuild?.status === "failed" && selectedBuild.errorMessage
      ? {
          label: "Build failed",
          message: selectedBuild.errorMessage,
        }
      : selectedBuild?.status === "succeeded_with_warning" &&
          selectedBuild.postDeployError
        ? {
            label: "Post-deploy hook failed",
            message: selectedBuild.postDeployError,
          }
        : null

  const handleSelectBuild = React.useCallback(
    (buildId: string) => {
      void navigate({
        href: `${pathname}?build=${encodeURIComponent(buildId)}`,
      })
    },
    [navigate, pathname]
  )

  const handleCloseDrawer = React.useCallback(() => {
    void navigate({ href: pathname })
  }, [navigate, pathname])

  const handleRollback = React.useCallback(
    (build: Build) => {
      rollback.mutate({ buildId: build.id })
    },
    [rollback]
  )

  const handleCancel = React.useCallback(
    (build: Build) => {
      cancelBuild.mutate({ buildId: build.id })
    },
    [cancelBuild]
  )

  if (error) {
    return (
      <div className="w-full px-4 py-6 md:px-8 md:py-8">
        <p className="text-sm text-destructive" role="alert">
          Failed to load deployments: {error.message}
        </p>
      </div>
    )
  }

  return (
    <div className="w-full space-y-4 px-4 py-6 md:px-8 md:py-8">
      <DeploymentLiveBanner appId={appId} />

      {selectedFailure ? (
        <div className="rounded-lg border border-destructive/25 bg-destructive/10 p-4">
          <div className="flex items-start gap-3">
            <RiErrorWarningLine
              className="mt-0.5 size-4 shrink-0 text-destructive"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-destructive">
                {selectedFailure.label}
              </p>
              <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/70 p-3 font-mono text-xs text-foreground">
                {selectedFailure.message}
              </pre>
            </div>
          </div>
        </div>
      ) : null}

      <DeploymentsTable
        builds={builds ?? []}
        isLoading={isLoading}
        onSelectBuild={handleSelectBuild}
        onRollback={handleRollback}
        onCancel={handleCancel}
      />

      <BuildLogDrawer
        appId={appId}
        buildId={selectedBuildId}
        build={selectedBuild}
        appName={app?.name}
        onClose={handleCloseDrawer}
      />

      <Separator />

      {app ? (
        <>
          <section className="flex flex-col gap-3">
            <header>
              <h2 className="text-base font-semibold text-foreground">
                Build & runtime
              </h2>
              <p className="text-xs text-muted-foreground">
                Deployment pipeline settings for this application.
              </p>
            </header>
            <AppBuildRuntimeSettings app={app} />
          </section>

          <Separator />
        </>
      ) : null}

      <section className="flex flex-col gap-3">
        <header>
          <h2 className="text-base font-semibold text-foreground">Triggers</h2>
          <p className="text-xs text-muted-foreground">
            How a push or a webhook becomes a deploy.
          </p>
        </header>
        <DeploymentTriggers appId={appId} />
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <header>
          <h2 className="text-base font-semibold text-foreground">Webhooks</h2>
          <p className="text-xs text-muted-foreground">
            Inbound provider deliveries and signing secret.
          </p>
        </header>
        <WebhooksPanel appId={appId} />
      </section>
    </div>
  )
}

export const Route = createFileRoute(
  "/_authed/orgs/$orgSlug/apps/$id/deployments"
)({
  validateSearch: validateDeploymentsSearch,
  component: AppDeploymentsTab,
})
