// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute, useParams } from "@tanstack/react-router"
import {
  RiGitBranchLine,
  RiInboxArchiveLine,
  RiShieldCheckLine,
  RiStackLine,
  RiWebhookLine,
} from "@remixicon/react"
import { toast } from "sonner"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Separator } from "@workspace/ui/components/separator"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { RotateSecretDialog } from "../../../../../../../components/webhooks/RotateSecretDialog"
import { WebhookDeliveriesTable } from "../../../../../../../components/webhooks/WebhookDeliveriesTable"
import { useApp } from "../../../../../../../lib/apps"

function WebhooksTab(): React.JSX.Element {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const { id } = useParams({ strict: false }) as { id: string }
  const { data: app, isLoading } = useApp(id)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [rotated, setRotated] = React.useState(false)

  const hasSecret = Boolean(app?.webhookSecret || rotated)

  const handleRotated = (): void => {
    setRotated(true)
    toast.success("Webhook secret rotated successfully")
  }

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

      <Separator />

      <Card className="border border-border/70 bg-background/95">
        <CardHeader className="gap-3 border-b border-border/60 pb-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Webhook Signature</Badge>
            <Badge variant={hasSecret ? "secondary" : "outline"}>
              {hasSecret ? "Configured" : "Missing"}
            </Badge>
          </div>
          <CardTitle className="font-heading text-2xl">
            Signing secret
          </CardTitle>
          <CardDescription className="max-w-2xl text-sm leading-6">
            Protect inbound webhook deliveries with a shared secret. Rotation
            is guarded by TOTP — the old secret stays valid 24 h so you can
            update the provider without interruption.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4 py-5">
          <div className="rounded-2xl border border-border/70 bg-muted/30 p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-col gap-1">
                <p className="text-[11px] tracking-[0.22em] text-muted-foreground uppercase">
                  Current state
                </p>
                <p className="font-heading text-xl">
                  {hasSecret ? "Secret is active" : "No secret configured yet"}
                </p>
              </div>
              <div className="rounded-xl border border-border/70 bg-background px-4 py-3 font-mono text-sm tracking-[0.28em]">
                {hasSecret ? "••••••••••••••••" : "not-set"}
              </div>
            </div>
          </div>

          <Alert>
            <RiShieldCheckLine />
            <AlertTitle>Grace period after rotation</AlertTitle>
            <AlertDescription>
              The old secret remains valid for 24 hours, which prevents
              downtime while provider settings are being updated.
            </AlertDescription>
          </Alert>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              Rotate secret
            </Button>
          </div>
        </CardContent>
      </Card>

      <RotateSecretDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        appId={id}
        onRotated={handleRotated}
      />
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

export const Route = createFileRoute("/_authed/orgs/$orgSlug/apps/$id/settings/webhooks")({
  component: WebhooksTab,
})
