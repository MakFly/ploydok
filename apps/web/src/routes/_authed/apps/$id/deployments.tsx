// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { DeploymentsTable } from "../../../../components/apps/DeploymentsTable"
import { BuildLogDrawer } from "../../../../components/apps/BuildLogDrawer"
import { useBuilds } from "../../../../lib/apps"
import { useRollbackApp } from "../../../../lib/apps-mutations"
import type { Build } from "@ploydok/shared"

// ---------------------------------------------------------------------------
// Search params type
// ---------------------------------------------------------------------------

interface DeploymentsSearch {
  build?: string
}

function validateDeploymentsSearch(search: Record<string, unknown>): DeploymentsSearch {
  return {
    build: typeof search["build"] === "string" ? search["build"] : undefined,
  }
}

// ---------------------------------------------------------------------------
// Route — with search param for drawer control
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/_authed/apps/$id/deployments")({
  validateSearch: validateDeploymentsSearch,
  component: AppDeploymentsTab,
})

// ---------------------------------------------------------------------------
// AppDeploymentsTab
// ---------------------------------------------------------------------------

function AppDeploymentsTab(): React.JSX.Element {
  const { id } = Route.useParams()
  const { build: selectedBuildId } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  const { data: builds, isLoading, error } = useBuilds(id)
  const rollback = useRollbackApp(id)

  const handleSelectBuild = React.useCallback(
    (buildId: string) => {
      void navigate({
        search: (prev: DeploymentsSearch) => ({ ...prev, build: buildId }),
        replace: false,
      })
    },
    [navigate],
  )

  const handleCloseDrawer = React.useCallback(() => {
    void navigate({
      search: (prev: DeploymentsSearch) => {
        const next: DeploymentsSearch = { ...prev }
        delete next.build
        return next
      },
      replace: false,
    })
  }, [navigate])

  const handleRollback = React.useCallback(
    (build: Build) => {
      rollback.mutate({ buildId: build.id })
    },
    [rollback],
  )

  if (error) {
    return (
      <p className="text-sm text-destructive" role="alert">
        Failed to load deployments: {error.message}
      </p>
    )
  }

  return (
    <div className="space-y-4">
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
