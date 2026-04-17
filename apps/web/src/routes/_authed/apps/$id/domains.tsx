// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useAddDomain, useDeleteDomain, useDomains, useRecheckDomain } from "../../../../lib/apps-domains"
import { DomainsTable } from "../../../../components/apps/DomainsTable"

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/_authed/apps/$id/domains")({
  component: AppDomainsTab,
})

// ---------------------------------------------------------------------------
// AppDomainsTab
// ---------------------------------------------------------------------------

function AppDomainsTab(): React.JSX.Element {
  const { id: appId } = Route.useParams()

  const { data: domains, isLoading, isError } = useDomains(appId)
  const { mutate: addDomain, isPending: isAdding } = useAddDomain(appId)
  const { mutate: deleteDomain, isPending: isDeleting } = useDeleteDomain(appId)
  const { mutate: recheckDomain, isPending: isRechecking } = useRecheckDomain(appId)

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-destructive/40 bg-destructive/5 py-12 text-center">
        <p className="text-sm font-medium text-destructive">Failed to load domains</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Check your connection and try refreshing.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 py-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Custom domains</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Point your DNS to this app and manage TLS certificates here.
          </p>
        </div>
      </div>

      <DomainsTable
        domains={domains ?? []}
        isLoading={isLoading}
        isAdding={isAdding}
        isDeleting={isDeleting}
        isRechecking={isRechecking}
        onAdd={(hostname) => addDomain({ hostname })}
        onDelete={(domainId) => deleteDomain({ domainId })}
        onRecheck={(domainId) => recheckDomain({ domainId })}
      />

      <p className="px-1 text-[11px] text-muted-foreground">
        After adding a domain, point a CNAME record to your app&apos;s default domain. TLS
        certificates are provisioned automatically via Caddy.
      </p>
    </div>
  )
}
