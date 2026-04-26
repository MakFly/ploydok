// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useParams, createFileRoute } from "@tanstack/react-router"
import {
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import { ChannelList } from "../../../../../../components/notifications/ChannelList"
import { useApp } from "../../../../../../lib/apps"
import type { AppDetail } from "../../../../../../lib/apps"

function AppSettingsGeneral(): React.JSX.Element {
  const { id } = useParams({ strict: false }) as { id: string }
  const { data: app, isLoading, error } = useApp(id)

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

        <div className="sm:col-span-2 xl:col-span-3">
          <ChannelList appId={id} />
        </div>
      </div>
    </div>
  )
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
