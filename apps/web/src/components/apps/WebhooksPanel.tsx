// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { RiShieldCheckLine } from "@remixicon/react"
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
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { RotateSecretDialog } from "../webhooks/RotateSecretDialog"
import { WebhookDeliveriesTable } from "../webhooks/WebhookDeliveriesTable"
import { useApp } from "../../lib/apps"

export function WebhooksPanel({ appId }: { appId: string }): React.JSX.Element {
  const { data: app } = useApp(appId)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [rotated, setRotated] = React.useState(false)

  const hasSecret = Boolean(app?.webhookSecret || rotated)

  const handleRotated = (): void => {
    setRotated(true)
    toast.success("Webhook secret rotated successfully")
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Incoming deliveries</CardTitle>
          <CardDescription>
            Every event your provider sent, the branch or tag it resolved to,
            and whether it started a deploy.
          </CardDescription>
          <CardAction>
            <div className="flex flex-wrap items-center gap-2">
              {app?.gitProvider ? (
                <Badge variant="secondary">{app.gitProvider}</Badge>
              ) : null}
            </div>
          </CardAction>
        </CardHeader>

        <CardContent>
          <WebhookDeliveriesTable appId={appId} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Signing secret</CardTitle>
          <CardDescription>
            A shared secret lets Ploydok verify that a delivery really came from
            your provider. Rotating it asks for your TOTP code.
          </CardDescription>
          <CardAction>
            <Badge variant={hasSecret ? "secondary" : "outline"}>
              {hasSecret ? "Configured" : "Missing"}
            </Badge>
          </CardAction>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <div className="rounded-lg border border-panel-border/70 bg-panel-inset p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-col gap-1">
                <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
                  Current state
                </p>
                <p className="text-sm font-medium">
                  {hasSecret ? "Secret is active" : "No secret configured yet"}
                </p>
              </div>
              <div className="rounded-lg border border-panel-border/70 bg-background px-3 py-2 font-mono text-sm">
                {hasSecret ? "••••••••••••••••" : "not-set"}
              </div>
            </div>
          </div>

          <Alert>
            <RiShieldCheckLine />
            <AlertTitle>The old secret keeps working for 24 hours</AlertTitle>
            <AlertDescription>
              You have a full day to paste the new secret into your provider
              before deliveries start failing.
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
        appId={appId}
        onRotated={handleRotated}
      />
    </div>
  )
}
