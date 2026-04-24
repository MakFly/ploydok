// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useEventsSubscription } from "../../../lib/events-provider"
import type { SyncStatus } from "./SyncProgressDialog"

// ---------------------------------------------------------------------------
// useSyncWithProgress — SSE-driven progress tracking.
//
// The Sync mutation only confirms enqueue; the worker reports actual progress
// via the existing /events SSE stream. We filter events by syncId (returned by
// POST /…/installations/sync) so concurrent syncs don't cross-contaminate.
//
// Event types (declared in apps/api/src/worker/event-bus.ts):
//   provider.sync.started    { provider, scope, syncId, installationCount? }
//   provider.sync.progress   { syncId, page, reposFetched, hasMore, ... }
//   provider.sync.completed  { syncId, totalRepos, durationMs }
//   provider.sync.failed     { syncId, error }
// ---------------------------------------------------------------------------

interface ProviderSyncEvent {
  syncId?: string | null
  page?: number
  reposFetched?: number
  totalRepos?: number
  installationCount?: number
  installationId?: string
  error?: string
  durationMs?: number
}

export interface SyncProgressState {
  open: boolean
  status: SyncStatus
  startedAt: number | null
  importedCount: number
  totalCount: number
  errorMessage?: string
  begin(syncId: string): void
  fail(message: string): void
  close(): void
}

export function useSyncWithProgress(): SyncProgressState {
  const [open, setOpen] = React.useState(false)
  const [syncId, setSyncId] = React.useState<string | null>(null)
  const [startedAt, setStartedAt] = React.useState<number | null>(null)
  const [status, setStatus] = React.useState<SyncStatus>("idle")
  const [errorMessage, setErrorMessage] = React.useState<string | undefined>(undefined)
  const [importedCount, setImportedCount] = React.useState(0)
  const [totalCount, setTotalCount] = React.useState(0)

  // Stable refs so useEventsSubscription doesn't re-attach on every render.
  const syncIdRef = React.useRef<string | null>(null)
  React.useEffect(() => { syncIdRef.current = syncId }, [syncId])

  function isMine(payload: ProviderSyncEvent): boolean {
    return syncIdRef.current != null && payload.syncId === syncIdRef.current
  }

  const onStarted = React.useCallback((payload: ProviderSyncEvent) => {
    if (!isMine(payload)) return
    setStatus("running")
  }, [])

  const onProgress = React.useCallback((payload: ProviderSyncEvent) => {
    if (!isMine(payload)) return
    if (typeof payload.reposFetched === "number") {
      setImportedCount(payload.reposFetched)
      setTotalCount((prev) => Math.max(prev, payload.reposFetched ?? 0))
    }
  }, [])

  const onCompleted = React.useCallback((payload: ProviderSyncEvent) => {
    if (!isMine(payload)) return
    if (typeof payload.totalRepos === "number") {
      setImportedCount(payload.totalRepos)
      setTotalCount((prev) => Math.max(prev, payload.totalRepos ?? 0))
    }
    setStatus("done")
  }, [])

  const onFailed = React.useCallback((payload: ProviderSyncEvent) => {
    if (!isMine(payload)) return
    setStatus("error")
    setErrorMessage(payload.error ?? "Sync failed")
  }, [])

  useEventsSubscription<ProviderSyncEvent>("provider.sync.started", onStarted)
  useEventsSubscription<ProviderSyncEvent>("provider.sync.progress", onProgress)
  useEventsSubscription<ProviderSyncEvent>("provider.sync.completed", onCompleted)
  useEventsSubscription<ProviderSyncEvent>("provider.sync.failed", onFailed)

  function begin(newSyncId: string): void {
    setSyncId(newSyncId)
    setStartedAt(Date.now())
    setStatus("running")
    setErrorMessage(undefined)
    setImportedCount(0)
    setTotalCount(0)
    setOpen(true)
  }

  function fail(message: string): void {
    setStatus("error")
    setErrorMessage(message)
    setOpen(true)
  }

  function close(): void {
    setOpen(false)
    // Reset on next tick so the dialog fades out cleanly.
    window.setTimeout(() => {
      setSyncId(null)
      setStartedAt(null)
      setStatus("idle")
      setErrorMessage(undefined)
      setImportedCount(0)
      setTotalCount(0)
    }, 250)
  }

  return {
    open,
    status,
    startedAt,
    importedCount,
    totalCount,
    errorMessage,
    begin,
    fail,
    close,
  }
}
