// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Button } from "@workspace/ui/components/button"
import type { Domain, TlsStatus } from "../../lib/domains"

// ---------------------------------------------------------------------------
// TLS status badge
// ---------------------------------------------------------------------------

function TlsBadge({ status }: { status: TlsStatus }): React.JSX.Element {
  if (status === "issued") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        Issued
      </span>
    )
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/30 dark:text-red-400">
        <span className="size-1.5 rounded-full bg-red-500" />
        Failed
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
      <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
      Pending
    </span>
  )
}

// ---------------------------------------------------------------------------
// TLS mode badge
// ---------------------------------------------------------------------------

function TlsModeBadge({ mode }: { mode: Domain["tlsMode"] }): React.JSX.Element {
  if (mode === "dns01") {
    return (
      <span className="inline-flex rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-mono text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">
        DNS-01
      </span>
    )
  }
  return (
    <span className="inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-600 dark:bg-slate-800 dark:text-slate-400">
      HTTP-01
    </span>
  )
}

// ---------------------------------------------------------------------------
// DomainCard
// ---------------------------------------------------------------------------

export interface DomainCardProps {
  domain: Domain
  onDelete: (domainId: string) => void
  onRetry: (domainId: string) => void
  onSwitchMode: (domainId: string) => void
  isDeleting?: boolean
  isRetrying?: boolean
}

export function DomainCard({
  domain,
  onDelete,
  onRetry,
  onSwitchMode,
  isDeleting,
  isRetrying,
}: DomainCardProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate font-mono text-sm font-medium">{domain.hostname}</span>
          <TlsModeBadge mode={domain.tlsMode} />
          {domain.dns01Provider && (
            <span className="text-[10px] text-muted-foreground">{domain.dns01Provider}</span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <TlsBadge status={domain.tlsStatus} />

          {domain.tlsStatus === "failed" && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              disabled={isRetrying}
              onClick={() => onRetry(domain.id)}
            >
              Retry
            </Button>
          )}

          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={() => onSwitchMode(domain.id)}
          >
            Switch TLS
          </Button>

          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs text-destructive hover:text-destructive"
            disabled={isDeleting}
            onClick={() => onDelete(domain.id)}
          >
            Remove
          </Button>
        </div>
      </div>

      {domain.tlsStatus === "pending" && domain.verifyToken && (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs dark:border-amber-800/50 dark:bg-amber-900/10">
          <p className="font-medium text-amber-800 dark:text-amber-400">Ownership verification required</p>
          <p className="mt-0.5 text-amber-700 dark:text-amber-500">
            Add a TXT record at{" "}
            <code className="font-mono">_ploydok-verify.{domain.hostname}</code> with value:
          </p>
          <code className="mt-1 block break-all font-mono text-amber-900 dark:text-amber-300">
            {domain.verifyToken}
          </code>
        </div>
      )}

      {domain.verifyError && domain.tlsStatus !== "issued" && (
        <p className="text-xs text-destructive">{domain.verifyError}</p>
      )}
    </div>
  )
}
