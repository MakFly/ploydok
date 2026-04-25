// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import {
  useNavigate,
  useParams,
  useRouterState,
  useSearch,
  createFileRoute,
} from "@tanstack/react-router"
import { DeploymentsTable } from "../../../../../../components/apps/DeploymentsTable"
import { BuildLogDrawer } from "../../../../../../components/apps/BuildLogDrawer"
import { useApp, useBuilds } from "../../../../../../lib/apps"
import {
  useRollbackApp,
  useCancelBuild,
} from "../../../../../../lib/apps-mutations"
import type { Build } from "@ploydok/shared"

interface DeploymentsSearch {
  build?: string
}

function validateDeploymentsSearch(
  search: Record<string, unknown>
): DeploymentsSearch {
  return {
    build: typeof search["build"] === "string" ? search["build"] : undefined,
  }
}

function AppDeploymentsTab(): React.JSX.Element {
  const { id } = useParams({ strict: false }) as { id: string }
  const { build: selectedBuildId } = useSearch({
    strict: false,
  }) as DeploymentsSearch
  const navigate = useNavigate()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  const { data: builds, isLoading, error } = useBuilds(id)
  const { data: app } = useApp(id)
  const rollback = useRollbackApp(id)
  const cancelBuild = useCancelBuild(id)

  const selectedBuild = React.useMemo(
    () => builds?.find((b) => b.id === selectedBuildId),
    [builds, selectedBuildId]
  )

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
      <DeploymentsTable
        builds={builds ?? []}
        isLoading={isLoading}
        onSelectBuild={handleSelectBuild}
        onRollback={handleRollback}
        onCancel={handleCancel}
      />

      <BuildLogDrawer
        appId={id}
        buildId={selectedBuildId}
        build={selectedBuild}
        appName={app?.name}
        onClose={handleCloseDrawer}
      />
    </div>
  )
}

export const Route = createFileRoute(
  "/_authed/orgs/$orgSlug/apps/$id/deployments"
)({
  validateSearch: validateDeploymentsSearch,
  component: AppDeploymentsTab,
})
