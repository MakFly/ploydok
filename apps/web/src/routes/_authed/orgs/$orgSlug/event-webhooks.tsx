// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { ShellPage, ShellPanel } from "../../../../components/layout/AppShell"
import {
  listEventWebhooks,
  deleteEventWebhook,
} from "../../../../lib/event-webhooks"

export const Route = createFileRoute("/_authed/orgs/$orgSlug/event-webhooks")({
  component: EventWebhooksPage,
})

function EventWebhooksPage(): React.JSX.Element {
  const { orgSlug } = Route.useParams()
  const qc = useQueryClient()
  const {
    data: webhooks = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["event-webhooks", orgSlug],
    queryFn: () => listEventWebhooks(orgSlug),
  })
  const del = useMutation({
    mutationFn: (id: string) => deleteEventWebhook(orgSlug, id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["event-webhooks", orgSlug] }),
  })

  return (
    <ShellPage
      title="Event webhooks"
      description="POST HTTP signé HMAC vers vos endpoints à chaque événement (deploy, app, service)."
      eyebrow="Workspace"
    >
      <ShellPanel
        title={`Webhooks (${webhooks.length})`}
        description="Intégration générique pour Slack, Discord, CI custom."
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
        ) : webhooks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun webhook. Utilise{" "}
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">
              POST /orgs/{orgSlug}/event-webhooks
            </code>{" "}
            pour en créer un.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {webhooks.map((w) => (
              <li
                key={w.id}
                className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{w.name}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {w.url}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {w.events.length} events ·{" "}
                    {w.enabled ? "enabled" : "disabled"}
                  </p>
                </div>
                <button
                  type="button"
                  className="text-xs text-destructive hover:underline"
                  onClick={() => del.mutate(w.id)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </ShellPanel>
    </ShellPage>
  )
}
