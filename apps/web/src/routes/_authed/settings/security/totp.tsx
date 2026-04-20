// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import {
  RiCheckboxCircleFill,
  RiDeleteBin6Line,
  RiLoader4Line,
  RiQrCodeLine,
  RiShieldKeyholeLine,
} from "@remixicon/react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"
import { QRCodeSVG } from "qrcode.react"
import { toast } from "sonner"
import {
  useDeleteTotp,
  useEnrollTotp,
  useTotpStatus,
  useVerifyTotp,
  type TotpEnrollResponse,
} from "../../../../lib/totp"

export const Route = createFileRoute("/_authed/settings/security/totp")({
  component: TotpPage,
})

function TotpPage(): React.JSX.Element {
  const { data: status, isLoading } = useTotpStatus()
  const [enrollData, setEnrollData] = React.useState<TotpEnrollResponse | null>(
    null
  )
  const [localVerified, setLocalVerified] = React.useState(false)
  const [code, setCode] = React.useState("")
  const [copied, setCopied] = React.useState(false)

  const enrollTotp = useEnrollTotp()
  const verifyTotp = useVerifyTotp()
  const deleteTotp = useDeleteTotp()

  const isEnrolled = localVerified || (status?.verified ?? false)

  const handleEnroll = (): void => {
    enrollTotp.mutate(undefined, {
      onSuccess: (data) => {
        setEnrollData(data)
        setCode("")
      },
      onError: (err) => {
        toast.error("Failed to start enrollment", { description: err.message })
      },
    })
  }

  const handleVerify = (): void => {
    verifyTotp.mutate(
      { code },
      {
        onSuccess: () => {
          setLocalVerified(true)
          setEnrollData(null)
          setCode("")
          toast.success("TOTP enabled", {
            description:
              "Your authenticator app is now linked. You will be prompted on next sign-in.",
          })
        },
        onError: (err) => {
          toast.error("Invalid code", { description: err.message })
        },
      }
    )
  }

  const handleCancel = (): void => {
    setEnrollData(null)
    setCode("")
  }

  const handleCopySecret = async (): Promise<void> => {
    if (!enrollData) return
    await navigator.clipboard.writeText(enrollData.secret)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDelete = (): void => {
    deleteTotp.mutate(undefined, {
      onSuccess: () => {
        setLocalVerified(false)
        toast.success("TOTP disabled", {
          description: "Two-factor authentication has been removed.",
        })
      },
      onError: (err) => {
        toast.error("Failed to disable TOTP", { description: err.message })
      },
    })
  }

  if (isLoading) {
    return (
      <CardFrame>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <RiLoader4Line className="size-3.5 animate-spin" />
          Loading…
        </p>
      </CardFrame>
    )
  }

  if (isEnrolled) {
    return <TotpEnabledView onDelete={handleDelete} isPending={deleteTotp.isPending} />
  }

  if (enrollData !== null) {
    return (
      <TotpScanView
        enrollData={enrollData}
        code={code}
        onCodeChange={setCode}
        onVerify={handleVerify}
        onCancel={handleCancel}
        onCopySecret={() => void handleCopySecret()}
        copied={copied}
        isPending={verifyTotp.isPending}
        error={verifyTotp.error}
      />
    )
  }

  return <TotpIdleView onEnable={handleEnroll} isPending={enrollTotp.isPending} />
}

function TotpIdleView({
  onEnable,
  isPending,
}: {
  onEnable: () => void
  isPending: boolean
}): React.JSX.Element {
  return (
    <CardFrame
      title="Authenticator app (TOTP)"
      description="Add a time-based one-time password from Google Authenticator, Authy, or 1Password as a second factor."
      icon={RiShieldKeyholeLine}
    >
      <Button
        size="sm"
        onClick={onEnable}
        disabled={isPending}
        className="mt-2"
      >
        {isPending ? (
          <RiLoader4Line className="mr-1.5 size-3.5 animate-spin" />
        ) : null}
        Enable TOTP
      </Button>
    </CardFrame>
  )
}

function TotpScanView({
  enrollData,
  code,
  onCodeChange,
  onVerify,
  onCancel,
  onCopySecret,
  copied,
  isPending,
  error,
}: {
  enrollData: TotpEnrollResponse
  code: string
  onCodeChange: (v: string) => void
  onVerify: () => void
  onCancel: () => void
  onCopySecret: () => void
  copied: boolean
  isPending: boolean
  error: { message: string } | null
}): React.JSX.Element {
  const isValidCode = /^[0-9]{6}$/.test(code)

  return (
    <CardFrame
      title="Scan this QR code"
      description="Open your authenticator app and scan the code below. Then enter the 6-digit code to confirm."
      icon={RiQrCodeLine}
    >
      <div className="mt-4 flex flex-col items-center gap-5">
        <div className="rounded-lg border border-border bg-white p-3">
          <QRCodeSVG value={enrollData.otpauthUrl} size={200} />
        </div>

        <div className="w-full space-y-1">
          <p className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
            Manual entry (copy-paste)
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded border border-border bg-muted px-2 py-1.5 font-mono text-xs text-foreground">
              {enrollData.secret}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={onCopySecret}
              className="shrink-0 font-mono text-[11px]"
            >
              {copied ? "Copied!" : "Copy"}
            </Button>
          </div>
        </div>

        <div className="w-full space-y-2">
          <label
            htmlFor="totp-code"
            className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase"
          >
            Verification code
          </label>
          <input
            id="totp-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(e) => onCodeChange(e.target.value.replace(/\D/g, ""))}
            placeholder="000000"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-center font-mono text-lg tracking-[0.4em] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary"
            aria-describedby={error ? "totp-error" : undefined}
          />
          {error ? (
            <p id="totp-error" role="alert" className="text-xs text-destructive">
              {error.message}
            </p>
          ) : null}
        </div>

        <div className="flex w-full gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={isPending}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={onVerify}
            disabled={!isValidCode || isPending}
            className="flex-1"
          >
            {isPending ? (
              <RiLoader4Line className="mr-1.5 size-3.5 animate-spin" />
            ) : null}
            Verify &amp; enable
          </Button>
        </div>
      </div>
    </CardFrame>
  )
}

function TotpEnabledView({
  onDelete,
  isPending,
}: {
  onDelete: () => void
  isPending: boolean
}): React.JSX.Element {
  return (
    <CardFrame
      title="Authenticator app (TOTP)"
      description="Your authenticator app is linked. You will be prompted for a code on each sign-in."
      icon={RiCheckboxCircleFill}
    >
      <div className="mt-3 flex items-center justify-between gap-4">
        <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
          <RiCheckboxCircleFill className="size-3.5 shrink-0" />
          TOTP enabled
        </p>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <RiDeleteBin6Line className="mr-1.5 size-3.5" />
              Disable TOTP
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogMedia>
                <RiDeleteBin6Line />
              </AlertDialogMedia>
              <AlertDialogTitle>Disable TOTP?</AlertDialogTitle>
              <AlertDialogDescription>
                Your authenticator app will no longer be required at sign-in.
                You can re-enable TOTP at any time.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={onDelete}>
                Disable TOTP
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </CardFrame>
  )
}

function CardFrame({
  title,
  description,
  icon: Icon,
  children,
}: {
  title?: string
  description?: string
  icon?: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      {title ? (
        <header className="mb-3 flex items-start gap-3">
          {Icon ? (
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
              <Icon className="size-4 text-muted-foreground" />
            </div>
          ) : null}
          <div className="space-y-1">
            <h3 className="text-sm font-medium">{title}</h3>
            {description ? (
              <p className="text-xs leading-5 text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
        </header>
      ) : null}
      {children}
    </section>
  )
}
