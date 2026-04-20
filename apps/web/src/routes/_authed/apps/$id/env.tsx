// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { EnvTable } from "../../../../components/apps/EnvTable"
import { useEnvVars, useUpdateEnvVars } from "../../../../lib/apps-env"
import { useMe } from "../../../../lib/auth"
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
  const { data: me } = useMe()
  const lockReason = me?.needs_second_factor
    ? "Configurez un second facteur pour modifier les variables d'environnement."
    : undefined

  function handleSave(vars: Array<EnvVarPatch>) {
    updateEnvVars(vars)
  }

  if (isLoading) {
    return <EnvSkeleton />
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
    <div className="mx-auto w-full max-w-5xl space-y-3 py-6">
      <EnvTable
        serverVars={serverVars}
        isSaving={isSaving}
        onSave={handleSave}
        lockReason={lockReason}
      />

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

function EnvSkeleton(): React.JSX.Element {
  return (
    <div
      className="mx-auto w-full max-w-5xl space-y-4 py-6"
      aria-busy="true"
      aria-label="Loading environment variables"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="h-4 w-44 rounded bg-muted animate-pulse" />
        <div className="h-7 w-16 rounded-md bg-muted animate-pulse" />
      </div>
      <div className="overflow-hidden rounded-xl border border-border">
        <div className="grid grid-cols-[minmax(200px,1.1fr)_minmax(260px,2fr)_auto_auto_auto] gap-0 border-b border-border bg-muted/40 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <span>Key</span>
          <span>Value</span>
          <span className="px-3">Secret</span>
          <span />
          <span />
        </div>
        <div className="divide-y divide-border animate-pulse">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="grid grid-cols-[minmax(200px,1.1fr)_minmax(260px,2fr)_auto_auto_auto] items-center gap-0 px-4 py-3"
            >
              <div className="pr-2">
                <div className="h-6 w-32 rounded border border-border bg-muted" />
              </div>
              <div className="pr-2">
                <div className="h-6 w-full rounded border border-border bg-muted" />
              </div>
              <div className="px-2">
                <div className="h-4 w-7 rounded-full bg-muted" />
              </div>
              <div className="flex justify-center">
                <div className="size-5 rounded bg-muted" />
              </div>
              <div className="flex justify-center">
                <div className="size-5 rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-border px-3 py-2">
          <div className="h-4 w-28 rounded bg-muted animate-pulse" />
        </div>
      </div>
    </div>
  )
}
