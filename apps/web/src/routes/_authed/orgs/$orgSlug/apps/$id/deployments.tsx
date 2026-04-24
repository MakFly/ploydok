// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useNavigate, useParams, useRouterState, useSearch, createFileRoute } from "@tanstack/react-router"
import { DeploymentsTable } from "../../../../../../components/apps/DeploymentsTable"
import { BuildLogDrawer } from "../../../../../../components/apps/BuildLogDrawer"
import { useBuilds } from "../../../../../../lib/apps"
import { useRollbackApp } from "../../../../../../lib/apps-mutations"
import type { Build } from "@ploydok/shared"

interface DeploymentsSearch {
  build?: string
}

function validateDeploymentsSearch(search: Record<string, unknown>): DeploymentsSearch {
  return {
    build: typeof search["build"] === "string" ? search["build"] : undefined,
  }
}

function AppDeploymentsTab(): React.JSX.Element {
  const { id } = useParams({ strict: false }) as { id: string }
  const { build: selectedBuildId } = useSearch({ strict: false }) as DeploymentsSearch
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  const { data: builds, isLoading, error } = useBuilds(id)
  const rollback = useRollbackApp(id)

  const handleSelectBuild = React.useCallback(
    (buildId: string) => {
      void navigate({ href: `${pathname}?build=${encodeURIComponent(buildId)}` })
    },
    [navigate, pathname],
  )

  const handleCloseDrawer = React.useCallback(() => {
    void navigate({ href: pathname })
  }, [navigate, pathname])

  const handleRollback = React.useCallback(
    (build: Build) => {
      rollback.mutate({ buildId: build.id })
    },
    [rollback],
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
      />

      <BuildLogDrawer
        appId={id}
        buildId={selectedBuildId}
        onClose={handleCloseDrawer}
      />
    </div>
  )
}

export const Route = createFileRoute("/_authed/orgs/$orgSlug/apps/$id/deployments")({
  validateSearch: validateDeploymentsSearch,
  component: AppDeploymentsTab,
})
