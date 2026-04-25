// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { ShellPage, ShellPanel } from "../../../../components/layout/AppShell"
import {
  listScheduledJobs,
  deleteScheduledJob,
  triggerScheduledJobRun,
} from "../../../../lib/scheduled-jobs"

export const Route = createFileRoute("/_authed/orgs/$orgSlug/scheduled-jobs")({
  component: ScheduledJobsPage,
})

function ScheduledJobsPage(): React.JSX.Element {
  const { orgSlug } = Route.useParams()
  const qc = useQueryClient()
  const {
    data: jobs = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["scheduled-jobs", orgSlug],
    queryFn: () => listScheduledJobs(orgSlug),
  })
  const del = useMutation({
    mutationFn: (id: string) => deleteScheduledJob(orgSlug, id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["scheduled-jobs", orgSlug] }),
  })
  const run = useMutation({
    mutationFn: (id: string) => triggerScheduledJobRun(orgSlug, id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["scheduled-jobs", orgSlug] }),
  })

  return (
    <ShellPage
      title="Scheduled jobs"
      description="Cron jobs exécutés par l'agent — container éphémère ou exec dans un container d'app."
      eyebrow="Workspace"
    >
      <ShellPanel
        title={`Jobs (${jobs.length})`}
        description="Chaque job tourne selon son expression cron."
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
        ) : jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun job. Crée via{" "}
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">
              POST /orgs/{orgSlug}/scheduled-jobs
            </code>
            .
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {jobs.map((j) => (
              <li
                key={j.id}
                className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{j.name}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {j.schedule_cron} · {j.kind}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {j.last_run_status
                      ? `last ${j.last_run_status}`
                      : "never ran"}
                    {j.next_run_at
                      ? ` · next ${new Date(j.next_run_at).toLocaleString()}`
                      : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline"
                    onClick={() => run.mutate(j.id)}
                  >
                    Run
                  </button>
                  <button
                    type="button"
                    className="text-xs text-destructive hover:underline"
                    onClick={() => del.mutate(j.id)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </ShellPanel>
    </ShellPage>
  )
}
