// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from "@tanstack/react-router"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { useQuery } from "@tanstack/react-query"
import { apiFetch } from "../../../../../../lib/api/client"
import { ApiError } from "../../../../../../lib/api/errors"

export const Route = createFileRoute(
  "/_authed/orgs/$orgSlug/apps/$id/previews"
)({
  component: PreviewsPage,
})

interface PreviewDeployment {
  id: string
  pr_number: number
  head_sha: string
  domain: string | null
  container_id: string | null
  status: "pending" | "building" | "running" | "torn_down" | "failed"
  created_at: string
  expires_at: string | null
}

function PreviewsPage() {
  const { id: appId } = Route.useParams()

  const {
    data: previews = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["app", appId, "previews"],
    queryFn: async () => {
      try {
        return await apiFetch<PreviewDeployment[]>(`/apps/${appId}/previews`)
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return []
        throw err
      }
    },
    retry: (failureCount, err) => {
      if (err instanceof ApiError && err.status === 404) return false
      return failureCount < 2
    },
  })

  if (isError) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-sm text-red-600">
          Failed to load preview deployments
        </p>
      </div>
    )
  }

  const activePreview = previews.filter((p) => p.status === "running")
  const inactivePreview = previews.filter((p) => p.status !== "running")

  return (
    <div className="w-full space-y-6 px-4 py-6 md:px-8 md:py-8">
      <div>
        <h1 className="text-2xl font-bold">Preview Deployments</h1>
        <p className="text-sm text-gray-600">
          Automatic deployments for pull requests
        </p>
      </div>

      {isLoading && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Loading...</p>
          </CardContent>
        </Card>
      )}

      {!isLoading && previews.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-10 text-center">
          <p className="text-sm text-muted-foreground">
            No preview deployments yet. Open a pull request to create one.
          </p>
        </div>
      )}

      {activePreview.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">Active</h2>
          <div className="space-y-3">
            {activePreview.map((p) => (
              <PreviewCard key={p.id} preview={p} appId={appId} />
            ))}
          </div>
        </div>
      )}

      {inactivePreview.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">Inactive</h2>
          <div className="space-y-3">
            {inactivePreview.map((p) => (
              <PreviewCard key={p.id} preview={p} appId={appId} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function PreviewCard({
  preview,
  appId,
}: {
  preview: PreviewDeployment
  appId: string
}) {
  const statusColor: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    building: "bg-blue-100 text-blue-800",
    running: "bg-green-100 text-green-800",
    torn_down: "bg-gray-100 text-gray-800",
    failed: "bg-red-100 text-red-800",
  }

  const handleTeardown = async () => {
    try {
      await apiFetch(`/apps/${appId}/previews/${preview.pr_number}/teardown`, {
        method: "POST",
      })
    } catch (err) {
      console.error("Failed to teardown preview:", err)
    }
  }

  const expiresAt = preview.expires_at
    ? new Date(preview.expires_at).toLocaleString()
    : "—"

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base">PR #{preview.pr_number}</CardTitle>
            <p className="font-mono text-xs text-gray-600">
              {preview.head_sha.slice(0, 7)}
            </p>
          </div>
          <Badge className={statusColor[preview.status]}>
            {preview.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {preview.domain && preview.status === "running" && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-600">Preview URL</p>
            <a
              href={`https://${preview.domain}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm break-all text-blue-600 hover:underline"
            >
              https://{preview.domain}
            </a>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-600">Created</p>
          <p className="text-sm">
            {new Date(preview.created_at).toLocaleString()}
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-600">Expires</p>
          <p className="text-sm">{expiresAt}</p>
        </div>

        {preview.status === "running" && (
          <Button
            variant="destructive"
            size="sm"
            onClick={handleTeardown}
            className="w-full"
          >
            Teardown
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
