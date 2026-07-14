// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute, useParams } from "@tanstack/react-router"
import { toast } from "sonner"
import {
  RiAddLine,
  RiDeleteBinLine,
  RiExternalLinkLine,
  RiGitBranchLine,
  RiGitCommitLine,
  RiGithubFill,
  RiGitlabFill,
  RiGlobalLine,
} from "@remixicon/react"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Switch } from "@workspace/ui/components/switch"
import { cn } from "@workspace/ui/lib/utils"
import { ChannelList } from "../../../../../../components/notifications/ChannelList"
import { AppIcon } from "../../../../../../components/apps/AppIcon"
import { useApp } from "../../../../../../lib/apps"
import { useUpdateAppSettings } from "../../../../../../lib/apps-mutations"
import type { AppDetail } from "../../../../../../lib/apps"
import type { AppQuickLink } from "@ploydok/shared"

function AppSettingsGeneral(): React.JSX.Element {
  const { id: routeAppId } = useParams({ strict: false })
  const appId = routeAppId!
  const { data: app, isLoading, error } = useApp(appId)

  if (isLoading) {
    return (
      <div className="w-full px-4 py-6 md:px-8 md:py-8">
        <SettingsSkeleton />
      </div>
    )
  }

  if (error || !app) {
    return (
      <div className="w-full px-4 py-6 md:px-8 md:py-8">
        <Alert variant="destructive">
          <AlertTitle>Failed to load settings</AlertTitle>
          <AlertDescription>
            {error?.message ?? "The application was not found."}
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="w-full px-4 py-6 md:px-8 md:py-8">
      <div className="grid w-full gap-6 sm:grid-cols-2 xl:grid-cols-3">
        <SourceCard app={app} />

        <AppMetadataCard app={app} />

        <div className="sm:col-span-2 xl:col-span-3">
          <ChannelList appId={appId} />
        </div>
      </div>
    </div>
  )
}

function AppMetadataCard({ app }: { app: AppDetail }): React.JSX.Element {
  const updateMutation = useUpdateAppSettings(app.id)
  const [iconUrl, setIconUrl] = React.useState(app.iconUrl ?? "")
  const [quickLinks, setQuickLinks] = React.useState<Array<AppQuickLink>>(
    app.quickLinks ?? []
  )
  const [trackLatest, setTrackLatest] = React.useState(app.trackLatest ?? false)

  React.useEffect(() => {
    setIconUrl(app.iconUrl ?? "")
    setQuickLinks(app.quickLinks ?? [])
    setTrackLatest(app.trackLatest ?? false)
  }, [app.iconUrl, app.quickLinks, app.trackLatest])

  function addQuickLink() {
    setQuickLinks((prev) =>
      prev.length >= 8 ? prev : [...prev, { label: "", url: "" }]
    )
  }

  function updateQuickLink(index: number, updates: Partial<AppQuickLink>) {
    setQuickLinks((prev) =>
      prev.map((link, i) => (i === index ? { ...link, ...updates } : link))
    )
  }

  function removeQuickLink(index: number) {
    setQuickLinks((prev) => prev.filter((_, i) => i !== index))
  }

  function handleSave() {
    const hasIncompleteLink = quickLinks.some(
      (link) => !link.label.trim() || !link.url.trim()
    )
    if (hasIncompleteLink) {
      toast.error("Every quick link needs both a label and a URL")
      return
    }
    const urls = [
      iconUrl.trim(),
      ...quickLinks.map((link) => link.url.trim()),
    ].filter(Boolean)
    if (urls.some((value) => !isSafeHttpUrl(value))) {
      toast.error("Icon and quick-link URLs must use http:// or https://")
      return
    }

    updateMutation.mutate({
      iconUrl: iconUrl.trim() || null,
      quickLinks: quickLinks.map((link) => ({
        label: link.label.trim(),
        url: link.url.trim(),
      })),
      ...(app.gitProvider === "image" ? { trackLatest } : {}),
    })
  }

  return (
    <Card className="sm:col-span-2 xl:col-span-3">
      <CardHeader>
        <CardTitle>Icon & quick links</CardTitle>
        <CardDescription>
          Dashboard icon and shortcut links shown for this app.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1 space-y-2">
              <Label htmlFor="app-icon-url">Icon URL</Label>
              <Input
                id="app-icon-url"
                type="url"
                value={iconUrl}
                onChange={(e) => setIconUrl(e.target.value)}
                placeholder="https://example.com/icon.png"
              />
            </div>
            {iconUrl && (
              <AppIcon
                name={app.name}
                src={iconUrl}
                className="size-10 sm:mt-7"
              />
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Quick links</Label>
              <span className="text-xs text-muted-foreground">
                {quickLinks.length}/8
              </span>
            </div>

            <div className="space-y-2">
              {quickLinks.map((link, idx) => (
                <div
                  key={idx}
                  className="flex flex-col gap-2 sm:flex-row sm:items-center"
                >
                  <Input
                    value={link.label}
                    onChange={(e) =>
                      updateQuickLink(idx, { label: e.target.value })
                    }
                    placeholder="Label"
                    maxLength={40}
                    className="sm:w-40"
                    aria-label="Quick link label"
                  />
                  <Input
                    type="url"
                    value={link.url}
                    onChange={(e) =>
                      updateQuickLink(idx, { url: e.target.value })
                    }
                    placeholder="https://example.com"
                    className="min-w-0 flex-1"
                    aria-label="Quick link URL"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeQuickLink(idx)}
                    aria-label={`Remove ${link.label || "quick link"}`}
                    className="shrink-0 self-end sm:self-auto"
                  >
                    <RiDeleteBinLine className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addQuickLink}
              disabled={quickLinks.length >= 8}
              className="gap-1.5"
            >
              <RiAddLine className="size-3.5" aria-hidden="true" />
              Add quick link
            </Button>
          </div>

          {app.gitProvider === "image" ? (
            <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-muted/30 p-3">
              <div className="space-y-1">
                <Label htmlFor="track-latest">Track image updates</Label>
                <p className="text-xs text-muted-foreground">
                  Redeploy this app when the configured image tag resolves to a
                  new registry digest.
                </p>
              </div>
              <Switch
                id="track-latest"
                checked={trackLatest}
                onCheckedChange={setTrackLatest}
                aria-label="Track image updates"
              />
            </div>
          ) : null}

          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? "Saving…" : "Save changes"}
          </Button>
        </>
      </CardContent>
    </Card>
  )
}

function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

function SourceCard({ app }: { app: AppDetail }): React.JSX.Element {
  const repoHref = buildRepoHref(app.gitProvider, app.repoFullName)
  const commitShort = app.currentCommitSha
    ? app.currentCommitSha.slice(0, 7)
    : null
  const commitHref =
    repoHref && app.currentCommitSha
      ? `${repoHref}/commit/${app.currentCommitSha}`
      : undefined
  const branchHref =
    repoHref && app.branch ? `${repoHref}/tree/${app.branch}` : undefined
  const ProviderIcon =
    app.gitProvider === "gitlab" ? RiGitlabFill : RiGithubFill

  return (
    <Card className="sm:col-span-2 xl:col-span-3">
      <CardHeader>
        <CardTitle>Source & domain</CardTitle>
        <CardDescription>
          Repository, current branch, latest deployed commit, and live URL.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <InfoTile
          label="Repository"
          value={app.repoFullName ?? "—"}
          href={repoHref}
          icon={<ProviderIcon className="size-3.5" aria-hidden="true" />}
        />
        <InfoTile
          label="Branch"
          value={app.branch ?? "main"}
          href={branchHref}
          mono
          icon={<RiGitBranchLine className="size-3.5" aria-hidden="true" />}
        />
        <InfoTile
          label="Current commit"
          value={commitShort ?? "—"}
          title={app.currentCommitSha ?? undefined}
          href={commitHref}
          mono
          icon={<RiGitCommitLine className="size-3.5" aria-hidden="true" />}
        />
        <InfoTile
          label="Domain"
          value={app.domain ?? "Not set"}
          href={app.publicUrl ?? undefined}
          muted={!app.domain}
          icon={<RiGlobalLine className="size-3.5" aria-hidden="true" />}
        />
      </CardContent>
    </Card>
  )
}

function buildRepoHref(
  provider: string | undefined,
  repoFullName: string | undefined
): string | undefined {
  if (!repoFullName) return undefined
  if (provider === "gitlab") return `https://gitlab.com/${repoFullName}`
  return `https://github.com/${repoFullName}`
}

function InfoTile({
  label,
  value,
  href,
  title,
  mono,
  muted,
  icon,
}: {
  label: string
  value: string
  href?: string
  title?: string
  mono?: boolean
  muted?: boolean
  icon?: React.ReactNode
}): React.JSX.Element {
  const valueClass = cn(
    "min-w-0 truncate text-sm",
    mono ? "font-mono" : "font-medium",
    muted ? "text-muted-foreground" : "text-foreground"
  )

  return (
    <div className="min-w-0 rounded-md border bg-muted/40 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {icon}
        {label}
      </p>
      <div className="mt-1.5 min-w-0">
        {href ? (
          <a
            className={cn(
              valueClass,
              "inline-flex max-w-full items-center gap-1.5 hover:underline"
            )}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={title ?? value}
          >
            <span className="truncate">{value}</span>
            <RiExternalLinkLine
              className="size-3 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          </a>
        ) : (
          <p className={valueClass} title={title ?? value}>
            {value}
          </p>
        )}
      </div>
    </div>
  )
}

function SettingsSkeleton(): React.JSX.Element {
  return (
    <div className="grid w-full gap-6 sm:grid-cols-2 xl:grid-cols-3">
      <Card className="sm:col-span-2 xl:col-span-3">
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-md" />
          ))}
        </CardContent>
      </Card>
      {Array.from({ length: 3 }).map((_, index) => (
        <Card
          key={index}
          className={index === 0 ? "sm:col-span-2 xl:col-span-2" : undefined}
        >
          <CardHeader>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-72" />
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export const Route = createFileRoute(
  "/_authed/orgs/$orgSlug/apps/$id/settings"
)({
  component: AppSettingsGeneral,
})
