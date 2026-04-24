// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import type { SyncStatus } from "./SyncProgressDialog"

// ---------------------------------------------------------------------------
// useSyncWithProgress
//
// Drives the SyncProgressDialog state by watching last_synced_at on the
// cache-status entries. The mutation only confirms enqueue, not completion;
// completion is when EVERY tracked installation has last_synced_at >=
// startedAt (or, for an empty cache, at least one row has appeared).
//
// Generic over the entry shape so GitHub (multi-install) and GitLab
// (single-install) can both reuse it.
// ---------------------------------------------------------------------------

export interface SyncProgressEntry {
  id: string
  lastSyncedAt: string
  repoCount: number
}

export interface SyncProgressState {
  open: boolean
  status: SyncStatus
  startedAt: number | null
  baselineCount: number
  importedCount: number
  totalCount: number
  errorMessage?: string
  begin(): void
  fail(message: string): void
  close(): void
}

export interface UseSyncWithProgressArgs {
  entries: Array<SyncProgressEntry>
  isMutationError: boolean
  mutationErrorMessage?: string
  scopeId?: string
}

export function useSyncWithProgress(args: UseSyncWithProgressArgs): SyncProgressState {
  const { entries, isMutationError, mutationErrorMessage, scopeId } = args

  const [open, setOpen] = React.useState(false)
  const [startedAt, setStartedAt] = React.useState<number | null>(null)
  const [baselineCount, setBaselineCount] = React.useState(0)
  // Snapshot the ids that existed at sync time. New installs that appear
  // mid-sync (first-ever bootstrap of an empty cache) are added on the fly.
  const [trackedIds, setTrackedIds] = React.useState<Set<string>>(new Set())

  const totalCount = React.useMemo(
    () => entries.reduce((sum, e) => sum + e.repoCount, 0),
    [entries],
  )
  const importedCount = Math.max(0, totalCount - baselineCount)

  let status: SyncStatus = "idle"
  if (isMutationError) {
    status = "error"
  } else if (startedAt != null) {
    const relevant = entries.filter(
      (e) =>
        trackedIds.has(e.id) ||
        // Bootstrap case: cache was empty at click-time, accept any
        // installation that surfaces afterwards as part of "this sync".
        (trackedIds.size === 0),
    )
    const allFresh =
      relevant.length > 0 &&
      relevant.every((e) => new Date(e.lastSyncedAt).getTime() >= startedAt)
    status = allFresh ? "done" : "running"
  }

  function begin(): void {
    setBaselineCount(totalCount)
    setTrackedIds(
      scopeId
        ? new Set([scopeId])
        : new Set(entries.map((e) => e.id)),
    )
    setStartedAt(Date.now())
    setOpen(true)
  }

  function fail(_message: string): void {
    setOpen(true)
  }

  function close(): void {
    setOpen(false)
    // Reset on next tick so the dialog can fade out cleanly.
    window.setTimeout(() => {
      setStartedAt(null)
      setBaselineCount(0)
      setTrackedIds(new Set())
    }, 250)
  }

  return {
    open,
    status,
    startedAt,
    baselineCount,
    importedCount,
    totalCount,
    errorMessage: isMutationError ? mutationErrorMessage : undefined,
    begin,
    fail,
    close,
  }
}
