// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useEnvVars, useUpdateEnvVars } from "../../../../lib/apps-env"
import { EnvTable } from "../../../../components/apps/EnvTable"
import type { EnvVarPatch } from "../../../../lib/apps-env"

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/_authed/apps/$id/env")({
  component: AppEnvTab,
})

// ---------------------------------------------------------------------------
// AppEnvTab
// ---------------------------------------------------------------------------

function AppEnvTab(): React.JSX.Element {
  const { id: appId } = Route.useParams()

  const { data: serverVars, isLoading, isError } = useEnvVars(appId)
  const { mutate: updateEnvVars, isPending: isSaving } = useUpdateEnvVars(appId)

  function handleSave(vars: Array<EnvVarPatch>) {
    updateEnvVars(vars)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
      </div>
    )
  }

  if (isError || !serverVars) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-destructive/40 bg-destructive/5 py-12 text-center">
        <p className="text-sm font-medium text-destructive">Failed to load environment variables</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Check your connection and try refreshing.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-2 py-6">
      <EnvTable serverVars={serverVars} isSaving={isSaving} onSave={handleSave} />

      <p className="px-1 text-[11px] text-muted-foreground">
        Changes apply on the next deployment.{" "}
        <span className="font-medium text-amber-600 dark:text-amber-400">
          Secret values are stored in plain text in this MVP
        </span>{" "}
        — encrypt-at-rest is planned for a future release.
      </p>
    </div>
  )
}
