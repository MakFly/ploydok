// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import {
  RiGitBranchLine,
  RiInboxArchiveLine,
  RiStackLine,
  RiWebhookLine,
} from "@remixicon/react"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { WebhookDeliveriesTable } from "../../../../../components/webhooks/WebhookDeliveriesTable"
import { useApp } from "../../../../../lib/apps"

export const Route = createFileRoute("/_authed/apps/$id/settings/webhooks")({
  component: WebhooksTab,
})

function WebhooksTab(): React.JSX.Element {
  const { id } = Route.useParams()
  const { data: app, isLoading } = useApp(id)

  return (
    <div className="flex w-full flex-col gap-6">
      <Card className="border border-border/70 bg-background/95">
        <CardHeader className="gap-3 border-b border-border/60 pb-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Webhook Journal</Badge>
            {app?.gitProvider ? (
              <Badge variant="secondary">{app.gitProvider}</Badge>
            ) : null}
          </div>
          <CardTitle className="font-heading text-2xl">
            Delivery timeline and decisions
          </CardTitle>
          <CardDescription className="max-w-2xl text-sm leading-6">
            Inspect each incoming event, the resolved branch or tag, and the
            build decision taken by the automation layer before a deploy is
            queued.
          </CardDescription>
        </CardHeader>

        <CardContent className="py-5">
          <WebhookDeliveriesTable appId={id} />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-6">
        <Card size="sm" className="border border-border/70 bg-muted/30">
          <CardHeader className="gap-2">
            <CardTitle>Decision inputs</CardTitle>
            <CardDescription>
              What Ploydok evaluates before it accepts a delivery.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {isLoading ? (
              <>
                <Skeleton className="h-16 rounded-xl" />
                <Skeleton className="h-16 rounded-xl" />
                <Skeleton className="h-16 rounded-xl" />
              </>
            ) : (
              <>
                <InsightItem
                  icon={<RiWebhookLine className="size-4" />}
                  title="Provider event"
                  description="Payload type, signature validity, and timestamp freshness."
                />
                <InsightItem
                  icon={<RiGitBranchLine className="size-4" />}
                  title="Target ref"
                  description={`Branch or tag alignment with ${app?.branch ?? "main"} and tag deploy rules.`}
                />
                <InsightItem
                  icon={<RiStackLine className="size-4" />}
                  title="Queue shaping"
                  description="Coalescing and disable flags decide whether a deployment is enqueued or skipped."
                />
              </>
            )}
          </CardContent>
        </Card>

        <Alert>
          <RiInboxArchiveLine />
          <AlertTitle>Operator hint</AlertTitle>
          <AlertDescription>
            If deliveries are missing, verify the provider secret first, then
            the tracked branch, then the auto-deploy switches from the General
            section.
          </AlertDescription>
        </Alert>
      </div>
    </div>
  )
}

function InsightItem({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description: string
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-background/85 px-3 py-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </span>
      <div className="flex flex-col gap-1">
        <p className="font-medium">{title}</p>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}
