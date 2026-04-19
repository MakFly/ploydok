// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import {
  RiAddLine,
  RiAlarmWarningLine,
  RiDeleteBin6Line,
  RiErrorWarningLine,
  RiFingerprintLine,
  RiKey2Line,
  RiLoader4Line,
  RiShieldKeyholeLine,
  RiSmartphoneLine,
  RiUsbLine,
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import { cn } from "@workspace/ui/lib/utils"
import {
  useAddPasskey,
  usePasskeys,
  useRemovePasskey,
} from "../../../../lib/passkeys"
import type { PasskeyInfo } from "@ploydok/shared"

export const Route = createFileRoute("/_authed/settings/security/passkeys")({
  component: PasskeysPage,
})

function PasskeysPage(): React.JSX.Element {
  const { data: passkeys, isLoading, error } = usePasskeys()
  const addPasskey = useAddPasskey()
  const [deviceName, setDeviceName] = React.useState("")
  const [addError, setAddError] = React.useState<string | null>(null)

  const handleAdd = async (): Promise<void> => {
    setAddError(null)
    try {
      await addPasskey.mutateAsync({ deviceName: deviceName || undefined })
      setDeviceName("")
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add passkey")
    }
  }

  if (error) {
    return (
      <CardFrame>
        <p className="text-sm text-destructive" role="alert">
          <RiErrorWarningLine className="mr-1.5 inline size-3.5 align-[-2px]" />
          Failed to load passkeys: {error.message}
        </p>
      </CardFrame>
    )
  }

  const isSoleKey = (passkeys?.length ?? 0) <= 1

  return (
    <div className="space-y-5">
      <CardFrame
        title="Register a new passkey"
        description="Your browser will prompt for Touch ID, Windows Hello, or a security key. The device name is optional but helps you recognize it later."
        icon={RiShieldKeyholeLine}
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void handleAdd()
          }}
        >
          <label className="sr-only" htmlFor="passkey-device-name">
            Device name
          </label>
          <InputGroup>
            <InputGroupAddon>
              <RiFingerprintLine />
            </InputGroupAddon>
            <InputGroupInput
              id="passkey-device-name"
              placeholder='e.g. "MacBook Pro — Touch ID"'
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              disabled={addPasskey.isPending}
              maxLength={60}
            />
            <InputGroupAddon align="inline-end">
              <Button
                type="submit"
                size="xs"
                disabled={addPasskey.isPending}
              >
                {addPasskey.isPending ? (
                  <>
                    <RiLoader4Line className="animate-spin" />
                    Registering
                  </>
                ) : (
                  <>
                    <RiAddLine />
                    Register
                  </>
                )}
              </Button>
            </InputGroupAddon>
          </InputGroup>
          {addError ? (
            <p
              role="alert"
              className="flex items-center gap-1.5 text-xs text-destructive"
            >
              <RiErrorWarningLine className="size-3.5" />
              {addError}
            </p>
          ) : null}
        </form>
      </CardFrame>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between px-1">
          <p className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
            Registered devices
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">
            {isLoading ? "…" : `${passkeys?.length ?? 0} total`}
          </p>
        </div>

        {isLoading ? (
          <LoadingRow />
        ) : passkeys && passkeys.length > 0 ? (
          <ul className="space-y-2">
            {passkeys.map((pk) => (
              <PasskeyRow key={pk.id} passkey={pk} canRemove={!isSoleKey} />
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={RiFingerprintLine}
            title="No passkeys registered"
            hint="Use the form above to enroll your first device."
          />
        )}
      </div>

      {isSoleKey && passkeys && passkeys.length > 0 ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs">
          <RiAlarmWarningLine className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="font-medium text-foreground">Single-point-of-failure</p>
            <p className="mt-0.5 text-muted-foreground">
              You cannot remove your last passkey without active backup codes.
              Enroll a second device — a phone, a hardware key, or another
              laptop — before travelling.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  )
}

interface DeviceKind {
  icon: React.ComponentType<{ className?: string }>
  tag: string
}

function inferDevice(name: string | null): DeviceKind {
  const n = (name ?? "").toLowerCase()
  if (/yubi|nitro|feitian|solokeys|hardware.?key|security.?key|usb/.test(n)) {
    return { icon: RiUsbLine, tag: "Hardware key" }
  }
  if (/iphone|ipad|android|phone|pixel|galaxy/.test(n)) {
    return { icon: RiSmartphoneLine, tag: "Mobile" }
  }
  if (/mac|touch.?id|macbook|imac/.test(n)) {
    return { icon: RiFingerprintLine, tag: "Touch ID" }
  }
  if (/windows|hello|thinkpad|surface/.test(n)) {
    return { icon: RiKey2Line, tag: "Windows Hello" }
  }
  return { icon: RiShieldKeyholeLine, tag: "Passkey" }
}

function PasskeyRow({
  passkey,
  canRemove,
}: {
  passkey: PasskeyInfo
  canRemove: boolean
}): React.JSX.Element {
  const removePasskey = useRemovePasskey()
  const [removeError, setRemoveError] = React.useState<string | null>(null)
  const { icon: Icon, tag } = inferDevice(passkey.device_name)
  const displayName = passkey.device_name ?? "Unnamed device"
  const createdAbs = new Date(passkey.created_at).toLocaleString()
  const lastUsedAbs = new Date(passkey.last_used_at).toLocaleString()

  const handleRemove = async (): Promise<void> => {
    setRemoveError(null)
    try {
      await removePasskey.mutateAsync(passkey.id)
    } catch (err) {
      setRemoveError(
        err instanceof Error ? err.message : "Failed to remove passkey"
      )
    }
  }

  return (
    <li className="group relative rounded-lg border border-border bg-card transition-colors hover:bg-muted/30">
      <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:gap-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
          <Icon className="size-4 text-muted-foreground" />
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium">{displayName}</p>
            <span className="inline-flex items-center rounded-full border border-border bg-background px-1.5 py-0.5 font-mono text-[9px] tracking-wide text-muted-foreground uppercase">
              {tag}
            </span>
          </div>
          <dl className="flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
            <div className="flex items-center gap-1">
              <dt className="opacity-60">added</dt>
              <dd title={createdAbs} className="text-foreground/80">
                {relativeTime(passkey.created_at)}
              </dd>
            </div>
            <div className="flex items-center gap-1">
              <dt className="opacity-60">last used</dt>
              <dd title={lastUsedAbs} className="text-foreground/80">
                {relativeTime(passkey.last_used_at)}
              </dd>
            </div>
          </dl>
          {removeError ? (
            <p role="alert" className="text-xs text-destructive">
              {removeError}
            </p>
          ) : null}
        </div>

        <div className="shrink-0">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                disabled={!canRemove || removePasskey.isPending}
                aria-label={`Remove ${displayName}`}
                className={cn(
                  "text-muted-foreground hover:text-destructive",
                  !canRemove && "cursor-not-allowed"
                )}
              >
                <RiDeleteBin6Line />
                Remove
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogMedia>
                  <RiDeleteBin6Line />
                </AlertDialogMedia>
                <AlertDialogTitle>Remove this passkey?</AlertDialogTitle>
                <AlertDialogDescription>
                  <span className="font-medium text-foreground">
                    {displayName}
                  </span>{" "}
                  will no longer be able to sign in. This cannot be undone —
                  you&apos;ll need to enroll the device again from scratch.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => void handleRemove()}
                >
                  Remove passkey
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </li>
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

function LoadingRow(): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border border-dashed bg-transparent p-4">
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <RiLoader4Line className="size-3.5 animate-spin" />
        Loading passkeys…
      </p>
    </div>
  )
}

function EmptyState({
  icon: Icon,
  title,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  hint: string
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border border-dashed bg-muted/20 px-4 py-10 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-muted">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-xs text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

function relativeTime(iso: string): string {
  const now = Date.now()
  const then = new Date(iso).getTime()
  const diff = Math.max(0, now - then)
  const s = Math.floor(diff / 1000)
  if (s < 45) return "just now"
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  const w = Math.floor(d / 7)
  if (w < 5) return `${w}w ago`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.floor(d / 365)}y ago`
}
