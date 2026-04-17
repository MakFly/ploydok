// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import {
  useRevokeOthers,
  useRevokeSession,
  useSessions,
} from "../../../../lib/sessions"

export const Route = createFileRoute("/_authed/settings/security/sessions")({
  component: SessionsPage,
})

function SessionsPage(): React.JSX.Element {
  const { data: sessions, isLoading, error } = useSessions()
  const revoke = useRevokeSession()
  const revokeOthers = useRevokeOthers()

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading sessions…</p>
  }

  if (error) {
    return (
      <p className="text-sm text-destructive" role="alert">
        Failed to load sessions: {error.message}
      </p>
    )
  }

  const hasCurrent = sessions?.some((s) => s.is_current)
  const others = sessions?.filter((s) => !s.is_current) ?? []

  const sortedSessions = [...(sessions ?? [])].sort((a, b) =>
    a.is_current === b.is_current ? 0 : a.is_current ? -1 : 1
  )

  return (
    <div className="space-y-4">
      {others.length > 0 && (
        <div className="flex justify-end">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => revokeOthers.mutate()}
            disabled={revokeOthers.isPending}
          >
            {revokeOthers.isPending
              ? "Signing out…"
              : "Sign out all other devices"}
          </Button>
        </div>
      )}

      <div className="space-y-2">
        {sortedSessions.map((session) => (
          <div
            key={session.id}
            className="flex items-center justify-between rounded-lg border border-border bg-card p-4"
          >
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="max-w-xs truncate text-sm font-medium">
                  {session.user_agent}
                </span>
                {session.is_current && (
                  <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-xs text-green-600 dark:text-green-400">
                    Current
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                IP: {session.ip} · Last seen:{" "}
                {new Date(session.last_seen_at).toLocaleString()}
              </p>
            </div>

            {!session.is_current && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => revoke.mutate(session.id)}
                disabled={revoke.isPending && revoke.variables === session.id}
              >
                Revoke
              </Button>
            )}
          </div>
        ))}
      </div>

      {sessions?.length === 0 && (
        <p className="text-sm text-muted-foreground">No active sessions.</p>
      )}

      {hasCurrent && (
        <p className="text-xs text-muted-foreground">
          To end your current session, use the Sign out option in the top menu.
        </p>
      )}
    </div>
  )
}
