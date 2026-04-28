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

// The /events SSE dispatcher delivers the full NotificationEvent envelope.
// Worker-side payloads land under `data` (see emit() in
// apps/api/src/worker/handlers/sync-provider-repos.ts).
interface ProviderSyncEnvelope {
  id: string
  type: string
  t: number
  message: string
  data?: ProviderSyncData
}

interface ProviderSyncData {
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
  begin: (syncId: string) => void
  fail: (message: string) => void
  close: () => void
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

  function isMine(envelope: ProviderSyncEnvelope): boolean {
    return (
      syncIdRef.current != null &&
      envelope.data?.syncId === syncIdRef.current
    )
  }

  const onStarted = React.useCallback((envelope: ProviderSyncEnvelope) => {
    if (!isMine(envelope)) return
    setStatus("running")
  }, [])

  const onProgress = React.useCallback((envelope: ProviderSyncEnvelope) => {
    if (!isMine(envelope)) return
    const fetched = envelope.data?.reposFetched
    if (typeof fetched === "number") {
      setImportedCount(fetched)
      setTotalCount((prev) => Math.max(prev, fetched))
    }
  }, [])

  const onCompleted = React.useCallback((envelope: ProviderSyncEnvelope) => {
    if (!isMine(envelope)) return
    const total = envelope.data?.totalRepos
    if (typeof total === "number") {
      setImportedCount(total)
      setTotalCount((prev) => Math.max(prev, total))
    }
    setStatus("done")
  }, [])

  const onFailed = React.useCallback((envelope: ProviderSyncEnvelope) => {
    if (!isMine(envelope)) return
    setStatus("error")
    setErrorMessage(envelope.data?.error ?? "Sync failed")
  }, [])

  useEventsSubscription<ProviderSyncEnvelope>("provider.sync.started", onStarted)
  useEventsSubscription<ProviderSyncEnvelope>("provider.sync.progress", onProgress)
  useEventsSubscription<ProviderSyncEnvelope>("provider.sync.completed", onCompleted)
  useEventsSubscription<ProviderSyncEnvelope>("provider.sync.failed", onFailed)

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
