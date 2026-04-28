// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { AdvisoryTable } from "../../../../admin/security/advisories"
import { useAppAdvisories } from "../../../../../../lib/advisories"

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
