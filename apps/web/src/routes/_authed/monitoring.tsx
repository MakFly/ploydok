// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useQueryClient } from "@tanstack/react-query"
import { useMonitoring, useMonitoringEvents, usePingContainer } from "../../lib/monitoring"
import { ResourceCard } from "../../components/monitoring/ResourceCard"
import { ShellPage } from "../../components/layout/AppShell"
import type { ContainerSnapshot, MonitoringOverview } from "@ploydok/shared"

export const Route = createFileRoute("/_authed/monitoring")({
  component: MonitoringPage,
})

// Ring buffer — keeps the last N values for a given key.
const RING_SIZE = 60

function appendRing(buf: Array<number>, value: number): Array<number> {
  const next = [...buf, value]
  return next.length > RING_SIZE ? next.slice(next.length - RING_SIZE) : next
}

type RingMap = Map<string, { cpu: Array<number>; mem: Array<number> }>

function MonitoringPage(): React.JSX.Element {
  const { data, isLoading, error } = useMonitoring()
  const queryClient = useQueryClient()
  const ping = usePingContainer()

  // Ring buffers — keyed by container id.
  const ringsRef = React.useRef<RingMap>(new Map())
  // Force re-render when SSE updates arrive without a polling refetch.
  const [, forceRender] = React.useReducer((n: number) => n + 1, 0)

  // Seed / update rings whenever polling data arrives.
  React.useEffect(() => {
    if (!data) return
    for (const snap of data.containers) {
      const prev = ringsRef.current.get(snap.id) ?? { cpu: [], mem: [] }
      ringsRef.current.set(snap.id, {
        cpu: appendRing(prev.cpu, snap.cpu_pct),
        mem: appendRing(prev.mem, snap.mem_bytes / (snap.mem_limit_bytes || 1)),
      })
    }
  }, [data])

  // SSE real-time updates — patch local ring + invalidate query cache.
  const handleHealthEvent = React.useCallback(
    (snap: ContainerSnapshot) => {
      const prev = ringsRef.current.get(snap.id) ?? { cpu: [], mem: [] }
      ringsRef.current.set(snap.id, {
        cpu: appendRing(prev.cpu, snap.cpu_pct),
        mem: appendRing(
          prev.mem,
          snap.mem_bytes / (snap.mem_limit_bytes || 1),
        ),
      })
      // Patch the query cache so polling picks up the fresh snapshot.
      queryClient.setQueryData<MonitoringOverview>(
        ["monitoring", "overview"],
        (old) => {
          if (!old) return old
          return {
            ...old,
            containers: old.containers.map((c) =>
              c.id === snap.id ? snap : c,
            ),
          }
        },
      )
      forceRender()
    },
    [queryClient],
  )

  useMonitoringEvents(handleHealthEvent)

  const containers = data?.containers ?? []

  // Derive simple summary stats.
  const healthy = containers.filter((c) => c.status === "running").length
  const total = containers.length

  return (
    <ShellPage
      title="Monitoring"
      description="Real-time health of all containers managed by the Ploydok platform."
      eyebrow="Infrastructure"
    >
      {/* Summary bar */}
      <div className="grid gap-4 md:grid-cols-3">
        <SummaryChip
          label="Total containers"
          value={isLoading ? "…" : String(total)}
          tone="neutral"
        />
        <SummaryChip
          label="Healthy"
          value={isLoading ? "…" : String(healthy)}
          tone="success"
        />
        <SummaryChip
          label="Issues"
          value={isLoading ? "…" : String(total - healthy)}
          tone={total - healthy > 0 ? "warning" : "neutral"}
        />
      </div>

      {/* Agent injoignable — API renvoie 503 avec un payload { error } */}
      {data?.error ? (
        <div
          role="alert"
          className="rounded-[1.5rem] border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <strong className="font-semibold">{data.error.code}</strong> — {data.error.message}
        </div>
      ) : null}

      {/* Erreur réseau / fetch */}
      {error ? (
        <div
          role="alert"
          className="rounded-[1.5rem] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          Failed to load monitoring data: {error.message}
        </div>
      ) : null}

      {/* Loading skeleton */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="animate-pulse rounded-[1.4rem] border border-border/70 bg-white/70 p-4"
            >
              <div className="mb-3 h-4 w-40 rounded bg-slate-200" />
              <div className="mb-2 h-3 w-28 rounded bg-slate-100" />
              <div className="h-8 rounded bg-slate-100" />
            </div>
          ))}
        </div>
      ) : null}

      {/* Container grid */}
      {!isLoading && containers.length === 0 ? (
        <div className="rounded-[1.5rem] border border-dashed border-border bg-white/60 px-4 py-12 text-center">
          <p className="text-sm font-medium text-slate-900">No containers found</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The agent will start reporting containers once services are running.
          </p>
        </div>
      ) : null}

      {!isLoading && containers.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {containers.map((snap) => {
            const rings = ringsRef.current.get(snap.id) ?? {
              cpu: [],
              mem: [],
            }
            return (
              <ResourceCard
                key={snap.id}
                snapshot={snap}
                cpuHistory={rings.cpu}
                memHistory={rings.mem}
                onPing={
                  snap.last_ping_ms !== undefined
                    ? () =>
                        ping.mutate({
                          id: snap.id,
                          path: "/",
                          port: 80,
                        })
                    : undefined
                }
              />
            )
          })}
        </div>
      ) : null}
    </ShellPage>
  )
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function SummaryChip({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: "neutral" | "success" | "warning"
}) {
  const cls =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-950"
        : "border-border/70 bg-white/90 text-slate-900"

  return (
    <div className={["rounded-[1.6rem] border px-5 py-4 shadow-sm", cls].join(" ")}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.28em] opacity-70">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  )
}
