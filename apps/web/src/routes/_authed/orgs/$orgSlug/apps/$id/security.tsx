// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { Badge } from "@workspace/ui/components/badge"
import { AdvisoryTable } from "../../../../admin/security/advisories"
import { useAppAdvisories } from "../../../../../../lib/advisories"
import { getLatestScan } from "../../../../../../lib/app-scans"
import type { BuildScanSummary } from "@ploydok/shared"

export const Route = createFileRoute(
  "/_authed/orgs/$orgSlug/apps/$id/security"
)({
  component: AppSecurityPage,
})

function AppSecurityPage(): React.JSX.Element {
  const { orgSlug, id } = Route.useParams()
  const { data, isLoading, error } = useAppAdvisories(orgSlug, id)

  return (
    <div className="w-full space-y-5 px-4 py-6 md:px-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Security</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Dependency advisories detected from the manifests captured at the last
          successful deployment.
        </p>
      </div>

      <ImageScanPanel appId={id} />

      {data?.disabled ? (
        <div className="rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          CVE scanning is disabled by `PLOYDOK_CVE_SCAN=off`.
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load app advisories.
        </div>
      ) : null}

      <AdvisoryTable rows={data?.matches ?? []} loading={isLoading} />
    </div>
  )
}

const SEVERITY_TONES = {
  critical: "bg-red-100 text-red-900",
  high: "bg-orange-100 text-orange-900",
  medium: "bg-yellow-100 text-yellow-900",
  low: "bg-blue-100 text-blue-900",
  unknown: "bg-muted text-muted-foreground",
} as const

function ScanSeverityBadge({
  label,
  count,
  tone,
}: {
  label: string
  count: number
  tone: keyof typeof SEVERITY_TONES
}): React.JSX.Element {
  return (
    <Badge className={SEVERITY_TONES[tone]}>
      {label}: {count}
    </Badge>
  )
}

function ImageScanPanel({ appId }: { appId: string }): React.JSX.Element {
  const { data, isLoading, error } = useQuery<BuildScanSummary | null>({
    queryKey: ["app", "scans", "latest", appId],
    queryFn: () => getLatestScan(appId),
    enabled: Boolean(appId),
  })

  return (
    <section className="space-y-3 rounded-md border border-border p-4">
      <div>
        <h2 className="text-sm font-medium text-foreground">
          Image vulnerabilities
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Trivy scan attached to the latest successful build.
        </p>
      </div>

      {error ? (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          Failed to load the latest image scan.
        </div>
      ) : isLoading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : !data ? (
        <div className="text-sm text-muted-foreground">No image scan yet.</div>
      ) : data.status === "pending" || data.status === "running" ? (
        <div
          className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground"
          aria-live="polite"
        >
          Image scan {data.status === "running" ? "in progress" : "queued"}…
        </div>
      ) : data.status === "skipped" ? (
        <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          Scanner not installed on this host — no vulnerability data available.
        </div>
      ) : data.status === "failed" ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          The last image scan failed.
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <ScanSeverityBadge
            label="Critical"
            count={data.critical}
            tone="critical"
          />
          <ScanSeverityBadge label="High" count={data.high} tone="high" />
          <ScanSeverityBadge label="Medium" count={data.medium} tone="medium" />
          <ScanSeverityBadge label="Low" count={data.low} tone="low" />
          <ScanSeverityBadge
            label="Unknown"
            count={data.unknown}
            tone="unknown"
          />
        </div>
      )}
    </section>
  )
}
