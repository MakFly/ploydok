// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import {
  RiCheckboxCircleFill,
  RiCloseCircleFill,
  RiErrorWarningLine,
  RiQuestionLine,
} from "@remixicon/react"
import { cn } from "@workspace/ui/lib/utils"
import { useSystemHealth, type ComponentStatus } from "../../lib/system-health"

const STATUS_STYLES: Record<
  ComponentStatus,
  {
    icon: React.ComponentType<{ className?: string }>
    text: string
    cls: string
  }
> = {
  ok: {
    icon: RiCheckboxCircleFill,
    text: "OK",
    cls: "text-emerald-600 dark:text-emerald-400",
  },
  degraded: {
    icon: RiErrorWarningLine,
    text: "Degraded",
    cls: "text-amber-600 dark:text-amber-400",
  },
  down: {
    icon: RiCloseCircleFill,
    text: "Down",
    cls: "text-destructive",
  },
  unknown: {
    icon: RiQuestionLine,
    text: "Unknown",
    cls: "text-muted-foreground",
  },
}

export function SystemHealthCard(): React.JSX.Element {
  const { data, isLoading, error } = useSystemHealth()

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="mt-3 grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded bg-muted/60" />
          ))}
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        <p className="font-mono text-[10px] tracking-wide uppercase opacity-80">
          system_health_unreachable
        </p>
        <p className="mt-1 text-xs">
          {error?.message ?? "No data"} — check API and {`/health/ready`}.
        </p>
      </div>
    )
  }

  return (
    <section
      aria-label="System status"
      className="rounded-xl border border-border bg-card"
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="space-y-0.5">
          <p className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
            System
          </p>
          <p className="text-sm font-medium">
            {data.ok ? "All systems operational" : "Some components degraded"}{" "}
            <span className="ml-1 font-mono text-[10px] text-muted-foreground">
              v{data.version}
            </span>
          </p>
        </div>
        <span
          className={cn(
            "inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-[11px] font-medium",
            data.ok
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              data.ok ? "bg-emerald-500" : "bg-amber-500"
            )}
          />
          {data.ok ? "Operational" : "Degraded"}
        </span>
      </header>
      <dl className="grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <ComponentCell
          label="Database"
          status={data.components.db.status}
          detail={
            data.components.db.latency_ms !== undefined
              ? `${data.components.db.latency_ms} ms`
              : data.components.db.error
          }
        />
        <ComponentCell
          label="Agent"
          status={data.components.agent.status}
          detail={data.components.agent.socket ?? data.components.agent.error}
        />
        <ComponentCell
          label="Caddy"
          status={data.components.caddy.status}
          detail={
            data.components.caddy.admin_url ?? data.components.caddy.error
          }
        />
      </dl>
    </section>
  )
}

function ComponentCell({
  label,
  status,
  detail,
}: {
  label: string
  status: ComponentStatus
  detail?: string
}): React.JSX.Element {
  const s = STATUS_STYLES[status]
  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <dt className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="flex items-center gap-1.5">
        <s.icon className={cn("size-4", s.cls)} />
        <span className={cn("text-sm font-medium", s.cls)}>{s.text}</span>
      </dd>
      {detail ? (
        <p
          className="truncate font-mono text-[10px] text-muted-foreground"
          title={detail}
        >
          {detail}
        </p>
      ) : null}
    </div>
  )
}
