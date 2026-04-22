// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Button } from "@workspace/ui/components/button"
import { DeliveryDetailsDialog } from "./DeliveryDetailsDialog"
import { listDeliveries } from "../../lib/webhooks"
import type { WebhookDelivery, DeliveryDecision } from "../../lib/webhooks"

// ---------------------------------------------------------------------------
// Decision badge
// ---------------------------------------------------------------------------

const DECISION_STYLE: Record<
  DeliveryDecision,
  { label: string; className: string }
> = {
  enqueued: {
    label: "Enqueued",
    className: "bg-green-500/10 text-green-700 dark:text-green-400",
  },
  coalesced: {
    label: "Coalesced",
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  retried: {
    label: "Retried",
    className: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  },
  skipped_disabled: {
    label: "Skipped",
    className: "bg-muted text-muted-foreground",
  },
  skipped_branch: {
    label: "Skipped",
    className: "bg-muted text-muted-foreground",
  },
  skipped_path: {
    label: "Skipped",
    className: "bg-muted text-muted-foreground",
  },
  skipped_directive: {
    label: "Skipped",
    className: "bg-muted text-muted-foreground",
  },
  skipped_unknown_app: {
    label: "Skipped",
    className: "bg-muted text-muted-foreground",
  },
  invalid_signature: {
    label: "Invalid sig.",
    className: "bg-destructive/10 text-destructive",
  },
  error: {
    label: "Error",
    className: "bg-destructive/10 text-destructive",
  },
}

function DecisionBadge({
  decision,
}: {
  decision: DeliveryDecision
}): React.JSX.Element {
  const style =
    DECISION_STYLE[decision] ?? DECISION_STYLE.skipped_disabled

  return (
    <span
      className={[
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium",
        style.className,
      ].join(" ")}
    >
      {style.label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Relative time helper
// ---------------------------------------------------------------------------

function relativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// ---------------------------------------------------------------------------
// Branch extraction
// ---------------------------------------------------------------------------

function refToBranch(ref: string): string {
  if (ref.startsWith("refs/heads/")) return ref.slice("refs/heads/".length)
  if (ref.startsWith("refs/tags/")) return ref.slice("refs/tags/".length)
  return ref
}

// ---------------------------------------------------------------------------
// WebhookDeliveriesTable
// ---------------------------------------------------------------------------

interface WebhookDeliveriesTableProps {
  appId: string
}

export function WebhookDeliveriesTable({
  appId,
}: WebhookDeliveriesTableProps): React.JSX.Element {
  const [deliveries, setDeliveries] = React.useState<Array<WebhookDelivery>>([])
  const [nextCursor, setNextCursor] = React.useState<string | undefined>(
    undefined,
  )
  const [loading, setLoading] = React.useState(true)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [selected, setSelected] = React.useState<WebhookDelivery | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    listDeliveries(appId)
      .then((page) => {
        if (cancelled) return
        setDeliveries(page.deliveries)
        setNextCursor(page.nextCursor)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : "Failed to load deliveries")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [appId])

  const handleLoadMore = async (): Promise<void> => {
    if (!nextCursor) return
    setLoadingMore(true)
    try {
      const page = await listDeliveries(appId, nextCursor)
      setDeliveries((prev) => [...prev, ...page.deliveries])
      setNextCursor(page.nextCursor)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more")
    } finally {
      setLoadingMore(false)
    }
  }

  const handleOpenDelivery = (delivery: WebhookDelivery): void => {
    setSelected(delivery)
    setDialogOpen(true)
  }

  const handleDeliveryReplayed = (_newDeliveryId: string): void => {
    // Refresh deliveries list to show the new replay entry
    setLoading(true)
    setError(null)
    listDeliveries(appId)
      .then((page) => {
        setDeliveries(page.deliveries)
        setNextCursor(page.nextCursor)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to reload deliveries")
      })
      .finally(() => setLoading(false))
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-2">
        {[...Array<null>(5)].map((_, i) => (
          <div key={i} className="h-10 rounded-md bg-muted" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {error}
      </p>
    )
  }

  if (deliveries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
          <svg
            aria-hidden="true"
            className="h-5 w-5 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
            />
          </svg>
        </div>
        <p className="text-sm font-medium">No deliveries received</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Make sure the webhook is properly configured on GitHub/GitLab.
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th
                scope="col"
                className="px-3 py-2.5 text-left font-medium text-muted-foreground"
              >
                Time
              </th>
              <th
                scope="col"
                className="px-3 py-2.5 text-left font-medium text-muted-foreground"
              >
                Event
              </th>
              <th
                scope="col"
                className="px-3 py-2.5 text-left font-medium text-muted-foreground"
              >
                Branch / Ref
              </th>
              <th
                scope="col"
                className="px-3 py-2.5 text-left font-medium text-muted-foreground"
              >
                Commit
              </th>
              <th
                scope="col"
                className="px-3 py-2.5 text-left font-medium text-muted-foreground"
              >
                Decision
              </th>
              <th scope="col" className="px-3 py-2.5">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {deliveries.map((d) => (
              <tr key={d.id} className="hover:bg-muted/20 transition-colors">
                <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                  <time dateTime={d.receivedAt} title={new Date(d.receivedAt).toISOString()}>
                    {relativeTime(d.receivedAt)}
                  </time>
                </td>
                <td className="px-3 py-2.5 font-mono whitespace-nowrap">
                  {d.event}
                </td>
                <td className="max-w-[120px] px-3 py-2.5 truncate">
                  {d.ref ? refToBranch(d.ref) : <span className="italic text-muted-foreground">—</span>}
                </td>
                <td className="px-3 py-2.5">
                  {d.commitSha ? (
                    <span className="font-mono">{d.commitSha.slice(0, 7)}</span>
                  ) : null}
                  {d.commitMessage && (
                    <span className="ml-1.5 text-muted-foreground truncate max-w-[120px] inline-block align-bottom">
                      {d.commitMessage.slice(0, 40)}
                      {d.commitMessage.length > 40 ? "…" : ""}
                    </span>
                  )}
                  {!d.commitSha && !d.commitMessage && (
                    <span className="italic text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <DecisionBadge decision={d.decision} />
                </td>
                <td className="px-3 py-2.5 text-right">
                  <button
                    type="button"
                    aria-label="Show delivery details"
                    onClick={() => handleOpenDelivery(d)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    •••
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {nextCursor && (
        <div className="mt-3 flex justify-center">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleLoadMore()}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}

      <DeliveryDetailsDialog
        delivery={selected}
        appId={appId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onDeliveryReplayed={handleDeliveryReplayed}
      />
    </>
  )
}
