// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  RiDeleteBin6Line,
  RiEraserLine,
  RiHardDriveLine,
  RiLoader4Line,
} from "@remixicon/react"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import {
  getDiskJob,
  getDiskUsage,
  pruneBuildCache,
  pruneImages,
} from "../../../lib/disk"
import { notifyMutationError } from "../../../lib/second-factor-toast"
import type { ApiError } from "../../../lib/api"
import type {
  DiskJobStatus,
  DiskUsageCategoryKind,
  DiskUsageResponse,
} from "@ploydok/shared"

export const Route = createFileRoute("/_authed/admin/disk")({
  component: AdminDiskPage,
})

const DISK_USAGE_QUERY_KEY = ["admin", "disk", "usage"] as const

const CATEGORY_LABELS: Record<DiskUsageCategoryKind, string> = {
  images: "Images",
  containers: "Containers",
  volumes: "Volumes",
  build_cache: "Build cache",
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1)
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function diskBarTone(pct: number): string {
  if (pct >= 90) return "bg-destructive"
  if (pct >= 75) return "bg-amber-500"
  return "bg-primary"
}

function AdminDiskPage(): React.JSX.Element {
  const qc = useQueryClient()
  const [activeJob, setActiveJob] = React.useState<{
    id: string
    label: string
  } | null>(null)
  const { data, isLoading, error } = useQuery<DiskUsageResponse, ApiError>({
    queryKey: DISK_USAGE_QUERY_KEY,
    queryFn: getDiskUsage,
  })

  const invalidateUsage = () =>
    qc.invalidateQueries({ queryKey: DISK_USAGE_QUERY_KEY })

  const { data: job, error: jobError } = useQuery<DiskJobStatus, ApiError>({
    queryKey: ["admin", "disk", "job", activeJob?.id],
    queryFn: () => getDiskJob(activeJob!.id),
    enabled: activeJob !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === "pending" || status === "running" ? 1_000 : false
    },
  })

  React.useEffect(() => {
    if (!activeJob) return
    if (jobError) {
      toast.error(jobError.message || `Failed to track ${activeJob.label}`)
      setActiveJob(null)
      return
    }
    if (!job) return
    if (job.status === "succeeded") {
      const reclaimed =
        job.kind === "gc.images" &&
        job.result &&
        "spaceReclaimedBytes" in job.result
          ? ` (${formatBytes(job.result.spaceReclaimedBytes)} reclaimed)`
          : ""
      toast.success(`${activeJob.label} complete${reclaimed}`)
      void invalidateUsage()
      setActiveJob(null)
    } else if (job.status === "failed" || job.status === "cancelled") {
      toast.error(job.errorMessage ?? `${activeJob.label} failed`)
      setActiveJob(null)
    }
  }, [activeJob, job, jobError])

  const pruneImagesMutation = useMutation({
    mutationFn: pruneImages,
    onSuccess: ({ jobId }: { jobId: string }) => {
      toast.success("Dangling image reclaim queued")
      setActiveJob({ id: jobId, label: "Dangling image reclaim" })
    },
    onError: (err: unknown) => notifyMutationError(err, "Reclaim failed"),
  })

  const pruneBuildCacheMutation = useMutation({
    mutationFn: pruneBuildCache,
    onSuccess: ({ jobId }: { jobId: string }) => {
      toast.success("Build cache prune queued")
      setActiveJob({ id: jobId, label: "Build cache prune" })
    },
    onError: (err: unknown) => notifyMutationError(err, "Prune failed"),
  })

  return (
    <div className="w-full space-y-5 px-4 py-6 md:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Disk usage</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Docker images, containers, volumes and build cache on the host, plus
            reclaim actions for dangling images and stale build cache.
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Button
            type="button"
            variant="outline"
            className="w-full gap-2 sm:w-auto"
            disabled={activeJob !== null || pruneImagesMutation.isPending}
            onClick={() => pruneImagesMutation.mutate()}
          >
            {pruneImagesMutation.isPending ? (
              <RiLoader4Line className="size-4 animate-spin" />
            ) : (
              <RiDeleteBin6Line className="size-4" />
            )}
            Reclaim dangling images
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full gap-2 sm:w-auto"
            disabled={activeJob !== null || pruneBuildCacheMutation.isPending}
            onClick={() => pruneBuildCacheMutation.mutate()}
          >
            {pruneBuildCacheMutation.isPending ? (
              <RiLoader4Line className="size-4 animate-spin" />
            ) : (
              <RiEraserLine className="size-4" />
            )}
            Prune build cache
          </Button>
        </div>
      </div>

      {activeJob ? (
        <p
          className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
          aria-live="polite"
        >
          <RiLoader4Line className="mr-2 inline size-4 animate-spin" />
          {activeJob.label} {job?.status === "running" ? "running" : "queued"}…
        </p>
      ) : null}

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load disk usage.
        </div>
      ) : null}

      {isLoading ? (
        <div className="space-y-3">
          <div className="h-24 animate-pulse rounded-xl border border-border bg-muted/40" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-xl border border-border bg-muted/40"
              />
            ))}
          </div>
        </div>
      ) : null}

      {data?.host ? <HostUsageCard host={data.host} /> : null}

      {data ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-foreground">Categories</h2>
            <span className="font-mono text-xs text-muted-foreground">
              Image layers: {formatBytes(data.layersSizeBytes)}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {data.categories.map((category) => (
              <CategoryCard key={category.kind} category={category} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function HostUsageCard({
  host,
}: {
  host: NonNullable<DiskUsageResponse["host"]>
}): React.JSX.Element {
  const pct =
    host.totalBytes > 0
      ? Math.min((host.usedBytes / host.totalBytes) * 100, 100)
      : 0

  return (
    <section
      aria-label="Host disk usage"
      className="rounded-xl border border-border bg-card p-4"
    >
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <RiHardDriveLine className="size-4 text-muted-foreground" />
        Host disk
      </div>
      <div className="mt-3 space-y-1.5">
        <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {formatBytes(host.usedBytes)} used of {formatBytes(host.totalBytes)}
          </span>
          <span className="tabular-nums">{pct.toFixed(0)}%</span>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={cn(
              "h-full rounded-full transition-all",
              diskBarTone(pct)
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {formatBytes(host.freeBytes)} free
        </p>
      </div>
    </section>
  )
}

function CategoryCard({
  category,
}: {
  category: DiskUsageResponse["categories"][number]
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
      <p className="text-sm font-medium text-foreground">
        {CATEGORY_LABELS[category.kind]}
      </p>
      <p className="text-xl font-medium text-foreground tabular-nums">
        {formatBytes(category.totalBytes)}
      </p>
      <dl className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
        <dt>Reclaimable</dt>
        <dd className="text-right tabular-nums">
          {formatBytes(category.reclaimableBytes)}
        </dd>
        <dt>Count</dt>
        <dd className="text-right tabular-nums">{category.count}</dd>
      </dl>
    </div>
  )
}
