// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useParams, createFileRoute } from "@tanstack/react-router"
import {
  useDomains,
  useCreateDomain,
  useDeleteDomain,
  useSwitchTlsMode,
  useRetryVerification,
} from "../../../../../../lib/domains"
import { DomainCard } from "../../../../../../components/domains/DomainCard"
import { AddDomainDialog } from "../../../../../../components/domains/AddDomainDialog"
import { TlsModeSwitcher } from "../../../../../../components/domains/TlsModeSwitcher"
import { useMe } from "../../../../../../lib/auth"
import type { Domain } from "../../../../../../lib/domains"

function AppDomainsTab(): React.JSX.Element {
  const { id: appId } = useParams({ strict: false }) as { id: string }

  const { data: domains, isLoading, isError } = useDomains(appId)
  const { mutate: createDomain, isPending: isAdding } = useCreateDomain(appId)
  const { mutate: deleteDomain, isPending: isDeleting } = useDeleteDomain(appId)
  const { mutate: switchTlsMode, isPending: isSwitching } = useSwitchTlsMode(appId)
  const { mutate: retryVerification, isPending: isRetrying } = useRetryVerification(appId)
  const { data: me } = useMe()

  const lockReason = me?.needs_second_factor
    ? "Configurez un second facteur pour modifier les domaines."
    : undefined

  const [switchTarget, setSwitchTarget] = React.useState<Domain | null>(null)

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
    <div className="w-full space-y-4 px-4 py-6 md:px-8 md:py-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Custom domains</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Point your DNS to this app and manage TLS certificates here.
          </p>
        </div>

        <AddDomainDialog
          onAdd={(params) => createDomain(params)}
          isAdding={isAdding}
          lockReason={lockReason}
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg border border-border bg-muted/30" />
          ))}
        </div>
      ) : domains && domains.length > 0 ? (
        <div className="space-y-2">
          {domains.map((domain) => (
            <DomainCard
              key={domain.id}
              domain={domain}
              onDelete={(id) => deleteDomain({ domainId: id })}
              onRetry={(id) => retryVerification({ domainId: id })}
              onSwitchMode={(id) => {
                const d = domains.find((d) => d.id === id)
                if (d) setSwitchTarget(d)
              }}
              isDeleting={isDeleting}
              isRetrying={isRetrying}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
          <p className="text-sm font-medium text-muted-foreground">No custom domains yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add a domain to expose your app on a custom URL.
          </p>
        </div>
      )}

      <p className="px-1 text-[11px] text-muted-foreground">
        After adding a domain, verify ownership by adding the TXT record shown. TLS certificates
        are provisioned automatically via Caddy.
      </p>

      {switchTarget && (
        <TlsModeSwitcher
          domainId={switchTarget.id}
          currentMode={switchTarget.tlsMode}
          open={Boolean(switchTarget)}
          onOpenChange={(open) => { if (!open) setSwitchTarget(null) }}
          onSwitch={(params) => switchTlsMode(params)}
          isSwitching={isSwitching}
        />
      )}
    </div>
  )
}

export const Route = createFileRoute("/_authed/orgs/$orgSlug/apps/$id/domains")({
  component: AppDomainsTab,
})
