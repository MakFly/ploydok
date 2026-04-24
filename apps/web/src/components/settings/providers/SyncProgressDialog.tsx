// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import {
  RiCheckboxCircleFill,
  RiErrorWarningFill,
  RiRefreshLine,
} from "@remixicon/react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Button } from "@workspace/ui/components/button"

// ---------------------------------------------------------------------------
// Status semantics
// ---------------------------------------------------------------------------
//
// "running" — mutation in flight OR no installation rows have a fresh
//             last_synced_at yet (worker hasn't written anything).
// "done"    — every cached installation has last_synced_at >= startedAt.
//             For empty caches this requires at least one row to appear.
// "error"   — the enqueue mutation itself rejected (HTTP non-2xx).
//
// "running" is the default until the polling layer detects a "done" state.

export type SyncStatus = "idle" | "running" | "done" | "error"

export interface SyncProgressDialogProps {
  open: boolean
  onClose: () => void
  status: SyncStatus
  startedAt: number | null
  importedCount: number
  totalCount: number
  errorMessage?: string
  providerLabel: string
}

// ---------------------------------------------------------------------------

export function SyncProgressDialog(props: SyncProgressDialogProps): React.JSX.Element {
  const { open, onClose, status, startedAt, importedCount, totalCount, errorMessage, providerLabel } = props
  const elapsed = useElapsed(startedAt, status)

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {status === "done" ? (
              <RiCheckboxCircleFill className="size-5 text-emerald-600 dark:text-emerald-400" />
            ) : status === "error" ? (
              <RiErrorWarningFill className="size-5 text-destructive" />
            ) : (
              <RiRefreshLine className="size-5 animate-spin text-primary" />
            )}
            {status === "done"
              ? "Sync complete"
              : status === "error"
                ? "Sync failed"
                : `Synchronizing ${providerLabel}`}
          </DialogTitle>
          <DialogDescription>
            {status === "done"
              ? `Imported ${totalCount} ${totalCount === 1 ? "repo" : "repos"} in ${elapsed}s.`
              : status === "error"
                ? errorMessage ?? "Unknown error."
                : "Walking your provider API and writing the cache. You can close this dialog — the job keeps running in the background."}
          </DialogDescription>
        </DialogHeader>

        <ProgressBar status={status} />

        <div className="space-y-1 text-xs text-muted-foreground tabular-nums">
          <div className="flex justify-between">
            <span>Imported so far</span>
            <span className="font-mono">{importedCount}</span>
          </div>
          <div className="flex justify-between">
            <span>Cache total</span>
            <span className="font-mono">{totalCount}</span>
          </div>
          <div className="flex justify-between">
            <span>Elapsed</span>
            <span className="font-mono">{elapsed}s</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {status === "running" ? "Hide" : "Close"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------

function ProgressBar({ status }: { status: SyncStatus }): React.JSX.Element {
  if (status === "done") {
    return (
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full w-full bg-emerald-500" />
      </div>
    )
  }
  if (status === "error") {
    return (
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full w-full bg-destructive" />
      </div>
    )
  }
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className="indeterminate-bar h-full w-1/3 bg-primary" />
      <style>{`
        @keyframes indeterminate-bar { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }
        .indeterminate-bar { animation: indeterminate-bar 1.4s ease-in-out infinite; }
      `}</style>
    </div>
  )
}

// ---------------------------------------------------------------------------
// useElapsed — ticks every second while status is "running" so the user sees
// time advance, then freezes once the job reaches "done"/"error".
// ---------------------------------------------------------------------------

function useElapsed(startedAt: number | null, status: SyncStatus): number {
  const [now, setNow] = React.useState(() => Date.now())

  React.useEffect(() => {
    if (status !== "running" || startedAt == null) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [status, startedAt])

  if (startedAt == null) return 0
  const ref = status === "running" ? now : Math.max(now, startedAt)
  return Math.max(0, Math.floor((ref - startedAt) / 1000))
}
