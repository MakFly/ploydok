// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { RiApps2Line, RiCpuLine, RiDatabase2Line, RiGitBranchLine } from "@remixicon/react"
import { apiFetch, type ApiError } from "../../lib/api"
import { cn } from "@workspace/ui/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FleetQuotas {
  apps: number
  running: number
  cpu: { declared: number }
  mem: { declared_bytes: number }
  pids: { declared: number }
}

export function useFleetQuotas() {
  return useQuery<FleetQuotas, ApiError>({
    queryKey: ["monitoring", "fleet", "quotas"],
    queryFn: () => apiFetch<FleetQuotas>("/monitoring/fleet/quotas"),
    staleTime: 30_000,
  })
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function QuotaUsageCard(): React.JSX.Element {
  const { data, isLoading, error } = useFleetQuotas()

  return (
    <section
      aria-label="Quotas usage"
      className="rounded-xl border border-border bg-card p-5"
    >
      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
            Fleet quotas
          </p>
          <h2 className="text-sm font-medium">Déclaration par plan</h2>
        </div>
        <CountPill value={data?.running ?? 0} total={data?.apps ?? 0} />
      </header>

      {isLoading ? (
        <Skeleton />
      ) : error ? (
        <p className="text-xs text-destructive" role="alert">
          {error.message}
        </p>
      ) : !data ? null : (
        <dl className="grid gap-3 sm:grid-cols-3">
          <Stat
            icon={RiCpuLine}
            label="CPU déclaré"
            value={`${data.cpu.declared.toFixed(2)} cores`}
            hint="Somme plan/custom"
          />
          <Stat
            icon={RiDatabase2Line}
            label="Mémoire déclarée"
            value={formatBytes(data.mem.declared_bytes)}
            hint="Total apps"
          />
          <Stat
            icon={RiGitBranchLine}
            label="PIDs déclarés"
            value={String(data.pids.declared)}
            hint="Cap des processus"
          />
        </dl>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function CountPill({ value, total }: { value: number; total: number }): React.JSX.Element {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
      <RiApps2Line className="size-3" />
      {value} running / {total} apps
    </div>
  )
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  hint?: string
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-md border border-border bg-background p-3">
      <dt className="flex items-center gap-1.5 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
        <Icon className="size-3" />
        {label}
      </dt>
      <dd className="font-heading text-lg font-medium tabular-nums">{value}</dd>
      {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
    </div>
  )
}

function Skeleton(): React.JSX.Element {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "h-20 animate-pulse rounded-md border border-border bg-muted/40",
          )}
        />
      ))}
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
