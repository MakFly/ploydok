// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"
import { toast } from "sonner"
import { apiFetch } from "../../lib/api"
import { usePruneRegistry } from "../../lib/apps-mutations"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegistryUsage {
  tags: number
  bytes: number
  diskPct: number
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1)
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function diskBarTone(diskPct: number): string {
  if (diskPct >= 80) return "bg-destructive"
  if (diskPct >= 60) return "bg-foreground"
  return "bg-primary"
}

// ---------------------------------------------------------------------------
// Query hook
// ---------------------------------------------------------------------------

export function useRegistryUsage(appId: string) {
  return useQuery<RegistryUsage, Error>({
    queryKey: ["apps", appId, "registry-usage"],
    queryFn: () => apiFetch<RegistryUsage>(`/apps/${appId}/registry-usage`),
    staleTime: 30_000,
    enabled: Boolean(appId),
  })
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

interface Props {
  appId: string
}

export function RegistryUsageWidget({ appId }: Props): React.JSX.Element {
  const { data, isLoading, error } = useRegistryUsage(appId)
  const prune = usePruneRegistry(appId)
  const [confirmOpen, setConfirmOpen] = React.useState(false)

  const handlePrune = async (): Promise<void> => {
    setConfirmOpen(false)
    try {
      const result = await prune.mutateAsync()
      toast.success(
        `Pruned ${result.tagsDeleted} image(s) across ${result.reposScanned} repo(s).`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "GC failed")
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-medium text-foreground">Registry storage</h3>

      {isLoading && (
        <div className="space-y-2 animate-pulse">
          <div className="h-5 w-24 rounded bg-muted" />
          <div className="h-2 w-full rounded bg-muted" />
        </div>
      )}

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error.message}
        </p>
      )}

      {data && (
        <>
          <div className="flex items-baseline gap-3">
            <span className="text-2xl font-semibold tabular-nums text-foreground">
              {data.tags}
            </span>
            <span className="text-xs text-muted-foreground">
              image{data.tags !== 1 ? "s" : ""}
            </span>
            {data.bytes > 0 && (
              <span className="ml-auto font-mono text-xs text-muted-foreground">
                {formatBytes(data.bytes)}
              </span>
            )}
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Host disk</span>
              <span className="tabular-nums">{data.diskPct}%</span>
            </div>
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={data.diskPct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={`h-full rounded-full transition-all ${diskBarTone(data.diskPct)}`}
                style={{ width: `${Math.min(data.diskPct, 100)}%` }}
              />
            </div>
          </div>
        </>
      )}

      <div className="mt-auto pt-2">
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          disabled={prune.isPending || isLoading}
          onClick={() => setConfirmOpen(true)}
        >
          {prune.isPending ? "Pruning…" : "Prune now"}
        </Button>
      </div>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(o) => {
          if (!o) setConfirmOpen(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Prune registry images?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete all but the 3 most recent images for this app.
              Running containers are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmOpen(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => void handlePrune()}>
              Prune
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
