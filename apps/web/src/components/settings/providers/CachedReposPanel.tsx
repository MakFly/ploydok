// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import {
  RiCheckboxCircleFill,
  RiErrorWarningFill,
  RiRefreshLine,
} from "@remixicon/react"
import { Button } from "@workspace/ui/components/button"
import { toast } from "sonner"

// ---------------------------------------------------------------------------
// Types — minimal shape shared by the GitHub multi-installation view and the
// GitLab single-installation view. Each row maps 1:1 to a provider_installation
// in Postgres + a COUNT of provider_repos joined on it.
// ---------------------------------------------------------------------------

export interface CachedReposEntry {
  id: string
  accountLogin: string
  avatarUrl: string | null
  htmlUrl: string | null
  lastSyncedAt: string
  repoCount: number
  ageMs: number
  status: "fresh" | "stale"
}

export interface CachedReposPanelProps {
  title: string
  description: string
  entries: Array<CachedReposEntry>
  isLoading: boolean
  isError: boolean
  errorMessage?: string
  onSyncOne?: (id: string) => Promise<unknown>
  onSyncAll?: () => Promise<unknown>
  isSyncing: boolean
  emptyState: React.ReactNode
}

// ---------------------------------------------------------------------------

export function CachedReposPanel(props: CachedReposPanelProps): React.JSX.Element {
  const {
    title,
    description,
    entries,
    isLoading,
    isError,
    errorMessage,
    onSyncOne,
    onSyncAll,
    isSyncing,
    emptyState,
  } = props

  const [pendingId, setPendingId] = React.useState<string | null>(null)

  async function handleOne(id: string): Promise<void> {
    if (!onSyncOne) return
    setPendingId(id)
    try {
      await onSyncOne(id)
      toast.success("Sync triggered — repos refresh in the background")
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Sync failed: ${msg}`)
    } finally {
      setPendingId(null)
    }
  }

  async function handleAll(): Promise<void> {
    if (!onSyncAll) return
    try {
      await onSyncAll()
      toast.success("Sync triggered for every installation")
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Sync failed: ${msg}`)
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {onSyncAll && entries.length > 1 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleAll()}
            disabled={isSyncing}
          >
            <RiRefreshLine
              className={`mr-1.5 size-3.5 ${isSyncing ? "animate-spin" : ""}`}
            />
            {isSyncing ? "Syncing..." : "Sync all"}
          </Button>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card">
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading cache status…</div>
        ) : isError ? (
          <p className="p-6 text-sm text-destructive" role="alert">
            Failed to load cache status: {errorMessage ?? "unknown error"}
          </p>
        ) : entries.length === 0 ? (
          <div className="space-y-3 p-6">
            {emptyState}
            {onSyncAll && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleAll()}
                disabled={isSyncing}
              >
                <RiRefreshLine
                  className={`mr-1.5 size-3.5 ${isSyncing ? "animate-spin" : ""}`}
                />
                {isSyncing ? "Syncing..." : "Sync now"}
              </Button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {entries.map((e) => (
              <CacheRow
                key={e.id}
                entry={e}
                pending={pendingId === e.id}
                disabled={isSyncing}
                onSync={onSyncOne ? () => void handleOne(e.id) : undefined}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------

function CacheRow({
  entry,
  pending,
  disabled,
  onSync,
}: {
  entry: CachedReposEntry
  pending: boolean
  disabled: boolean
  onSync?: () => void
}): React.JSX.Element {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      {entry.avatarUrl ? (
        <img
          src={entry.avatarUrl}
          alt=""
          className="size-8 shrink-0 rounded-full border border-border"
          loading="lazy"
        />
      ) : (
        <div className="size-8 shrink-0 rounded-full border border-border bg-muted" />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{entry.accountLogin}</p>
          <StatusPill status={entry.status} />
        </div>
        <p className="text-xs text-muted-foreground">
          {entry.repoCount} {entry.repoCount === 1 ? "repo" : "repos"} cached · synced{" "}
          {formatAge(entry.ageMs)}
        </p>
      </div>

      {onSync && (
        <Button
          variant="outline"
          size="sm"
          onClick={onSync}
          disabled={pending || disabled}
        >
          <RiRefreshLine
            className={`mr-1.5 size-3.5 ${pending ? "animate-spin" : ""}`}
          />
          {pending ? "Syncing..." : "Sync"}
        </Button>
      )}
    </li>
  )
}

function StatusPill({ status }: { status: "fresh" | "stale" }): React.JSX.Element {
  if (status === "fresh") {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[10px] tracking-wide text-emerald-600 uppercase dark:text-emerald-400">
        <RiCheckboxCircleFill className="size-3" />
        Fresh
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[10px] tracking-wide text-amber-600 uppercase dark:text-amber-400">
      <RiErrorWarningFill className="size-3" />
      Stale
    </span>
  )
}

// ---------------------------------------------------------------------------
// formatAge — human-friendly relative time. Avoids importing Intl.RelativeTime
// to keep this pure and SSR-safe.
// ---------------------------------------------------------------------------

function formatAge(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000))
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return `${day}d ago`
}
