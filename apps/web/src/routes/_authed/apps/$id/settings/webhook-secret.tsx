// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute, useParams } from "@tanstack/react-router"
import {
  RiFileCopyLine,
  RiLockPasswordLine,
  RiShieldCheckLine,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { useApp } from "../../../../../lib/apps"
import type { ApiError } from "../../../../../lib/api"
import { rotateWebhookSecret } from "../../../../../lib/webhooks"

export const Route = createFileRoute(
  "/_authed/apps/$id/settings/webhook-secret"
)({
  component: WebhookSecretTab,
})

type DialogStep = "totp" | "reveal"

interface RotateSecretDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  appId: string
  onRotated: () => void
}

function RotateSecretDialog({
  open,
  onOpenChange,
  appId,
  onRotated,
}: RotateSecretDialogProps): React.JSX.Element {
  const [step, setStep] = React.useState<DialogStep>("totp")
  const [totpCode, setTotpCode] = React.useState("")
  const [newSecret, setNewSecret] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)
  const secretInputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (!open) return

    setStep("totp")
    setTotpCode("")
    setNewSecret("")
    setPending(false)
    setError(null)
    setCopied(false)
  }, [open])

  const handleRotate = async (): Promise<void> => {
    if (totpCode.length !== 6) {
      setError("Please enter a 6-digit TOTP code.")
      return
    }

    setError(null)
    setPending(true)

    try {
      const result = await rotateWebhookSecret(appId, totpCode)
      setNewSecret(result.secret)
      setStep("reveal")
      requestAnimationFrame(() => {
        secretInputRef.current?.select()
      })
    } catch (err) {
      const apiErr = err as ApiError

      if (apiErr.code === "rotation_cooldown") {
        const hoursMatch = apiErr.message.match(/(\d+)\s*h/)
        const hours = hoursMatch ? hoursMatch[1] : "some time"
        setError(`Secret rotated recently. Try again after ${hours}h.`)
      } else {
        setError(apiErr.message ?? "Rotation failed. Check your TOTP code.")
      }
    } finally {
      setPending(false)
    }
  }

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(newSecret)
      setCopied(true)
      toast.success("Secret copied to clipboard")
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Failed to copy secret")
    }
  }

  const handleClose = (): void => {
    if (step === "reveal") {
      onRotated()
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="sm:max-w-xl"
        showCloseButton={step !== "reveal"}
      >
        <DialogHeader className="gap-3">
          <Badge variant="outline" className="w-fit">
            Secret Rotation
          </Badge>
          <DialogTitle>
            {step === "totp"
              ? "Confirm the rotation"
              : "Store the new secret now"}
          </DialogTitle>
          <DialogDescription className="leading-6">
            {step === "totp"
              ? "Use your authenticator to unlock a new webhook signing secret."
              : "This value is shown once. Copy it immediately and update the provider configuration before the grace window ends."}
          </DialogDescription>
        </DialogHeader>

        {step === "totp" ? (
          <div className="flex flex-col gap-4">
            <Alert>
              <RiShieldCheckLine />
              <AlertTitle>24-hour overlap window</AlertTitle>
              <AlertDescription>
                The previous secret stays valid for 24 hours so you can update
                GitHub or GitLab without interrupting incoming events.
              </AlertDescription>
            </Alert>

            <FieldGroup>
              <Field data-invalid={Boolean(error)}>
                <FieldContent className="gap-1">
                  <FieldLabel htmlFor="totp-code">
                    TOTP confirmation code
                  </FieldLabel>
                  <FieldDescription>
                    Enter the 6-digit code from your authenticator app.
                  </FieldDescription>
                </FieldContent>
                <Input
                  id="totp-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={totpCode}
                  aria-invalid={Boolean(error)}
                  className="font-mono tracking-[0.35em]"
                  placeholder="000000"
                  onChange={(event) =>
                    setTotpCode(
                      event.target.value.replace(/\D/g, "").slice(0, 6)
                    )
                  }
                />
                <FieldError>{error}</FieldError>
              </Field>
            </FieldGroup>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <Alert>
              <RiLockPasswordLine />
              <AlertTitle>Shown once</AlertTitle>
              <AlertDescription>
                Keep this secret in your webhook provider configuration and your
                secure notes. It cannot be retrieved later from the UI.
              </AlertDescription>
            </Alert>

            <FieldGroup>
              <Field>
                <FieldContent className="gap-1">
                  <FieldLabel htmlFor="new-secret">
                    New webhook secret
                  </FieldLabel>
                  <FieldDescription>
                    Copy the secret before closing this dialog.
                  </FieldDescription>
                </FieldContent>
                <InputGroup>
                  <InputGroupInput
                    ref={secretInputRef}
                    id="new-secret"
                    readOnly
                    value={newSecret}
                    aria-label="New webhook secret"
                    className="font-mono text-xs"
                  />
                  <InputGroupAddon align="inline-end">
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => void handleCopy()}
                      aria-label="Copy webhook secret to clipboard"
                    >
                      <RiFileCopyLine data-icon="inline-start" />
                      {copied ? "Copied" : "Copy"}
                    </Button>
                  </InputGroupAddon>
                </InputGroup>
              </Field>
            </FieldGroup>
          </div>
        )}

        <DialogFooter>
          {step === "totp" ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => void handleRotate()}
                disabled={pending || totpCode.length !== 6}
              >
                {pending ? "Verifying..." : "Rotate secret"}
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={handleClose}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function WebhookSecretTab(): React.JSX.Element {
  const { id } = useParams({ strict: false }) as { id: string }
  const { data: app, isLoading } = useApp(id)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [rotated, setRotated] = React.useState(false)

  const hasSecret = Boolean(app?.webhookSecret || rotated)

  const handleRotated = (): void => {
    setRotated(true)
    toast.success("Webhook secret rotated successfully")
  }

  if (isLoading) {
    return (
      <div className="flex w-full flex-col gap-6">
        <Card className="border border-border/70 bg-background/95">
          <CardHeader className="gap-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-8 w-72" />
            <Skeleton className="h-4 w-full max-w-xl" />
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-16 rounded-2xl" />
          </CardContent>
        </Card>
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    )
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <Card className="border border-border/70 bg-background/95">
        <CardHeader className="gap-3 border-b border-border/60 pb-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Webhook Signature</Badge>
            <Badge variant={hasSecret ? "secondary" : "outline"}>
              {hasSecret ? "Configured" : "Missing"}
            </Badge>
          </div>
          <CardTitle className="font-heading text-2xl">
            Secret rotation workspace
          </CardTitle>
          <CardDescription className="max-w-2xl text-sm leading-6">
            Protect inbound webhook deliveries with a dedicated shared secret
            and rotate it in a controlled flow guarded by TOTP confirmation.
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
              The old secret remains valid for 24 hours, which prevents downtime
              while provider settings are being updated.
            </AlertDescription>
          </Alert>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              Rotate secret
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card size="sm" className="border border-border/70 bg-muted/30">
        <CardHeader className="gap-2">
          <CardTitle>Rotation sequence</CardTitle>
          <CardDescription>
            Keep the process tight and reversible for operators.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <SequenceStep
            step="1"
            title="Confirm with TOTP"
            description="A six-digit code prevents silent or accidental rotation."
          />
          <SequenceStep
            step="2"
            title="Copy once"
            description="The fresh secret is only revealed in the post-rotation dialog."
          />
          <SequenceStep
            step="3"
            title="Update provider"
            description="Replace the secret in GitHub or GitLab before the overlap window expires."
          />
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

function SequenceStep({
  step,
  title,
  description,
}: {
  step: string
  title: string
  description: string
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-background/85 px-3 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground">
        {step}
      </span>
      <div className="flex flex-col gap-1">
        <p className="font-medium">{title}</p>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}
