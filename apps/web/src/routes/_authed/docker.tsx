// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { ShellPage, ShellPanel } from "../../components/layout/AppShell"
import { useDockerContainers } from "../../lib/docker-host"

export const Route = createFileRoute("/_authed/docker")({
  component: DockerHostPage,
})

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB", "TB"]
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(1)} ${units[i]}`
}

function formatUptime(s: number): string {
  if (!s) return "—"
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

function DockerHostPage(): React.JSX.Element {
  const { data: containers = [], isLoading, error } = useDockerContainers()

  const running = containers.filter((c) => c.status === "running").length

  return (
    <ShellPage
      title="Docker"
      description="Read-only vue des containers gérés par l'agent Ploydok sur cet hôte."
      eyebrow="Admin"
    >
      <ShellPanel
        title={`Containers (${running}/${containers.length} running)`}
        description="Snapshot live rafraîchi toutes les 10s via l'agent gRPC."
      >
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : error ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {(error as Error).message}
          </p>
        ) : containers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun container géré par l'agent.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs tracking-wide text-muted-foreground uppercase">
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Image</th>
                  <th className="py-2 pr-3">Kind</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Uptime</th>
                  <th className="py-2 pr-3">CPU</th>
                  <th className="py-2 pr-3">Memory</th>
                  <th className="py-2 pr-3">Restarts</th>
                </tr>
              </thead>
              <tbody>
                {containers.map((c) => (
                  <tr key={c.id} className="border-b border-border/60">
                    <td className="py-2 pr-3 font-mono text-xs">{c.name}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">
                      {c.image}
                    </td>
                    <td className="py-2 pr-3">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                        {c.kind || "—"}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={
                          c.status === "running"
                            ? "text-emerald-600"
                            : c.status === "unhealthy"
                              ? "text-amber-600"
                              : "text-muted-foreground"
                        }
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {formatUptime(c.uptime_s)}
                    </td>
                    <td className="py-2 pr-3">{c.cpu_pct.toFixed(1)}%</td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {formatBytes(c.mem_bytes)}
                      {c.mem_limit_bytes
                        ? ` / ${formatBytes(c.mem_limit_bytes)}`
                        : ""}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {c.restart_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ShellPanel>
    </ShellPage>
  )
}
