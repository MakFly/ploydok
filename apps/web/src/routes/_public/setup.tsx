// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { startRegistration } from "@simplewebauthn/browser"
import { QRCodeSVG } from "qrcode.react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { toast } from "sonner"
import { apiFetch } from "../../lib/api"
import { organizationDashboardPath } from "../../lib/organizations"
import type { Me } from "@ploydok/shared"

interface SetupSearch {
  token?: string
}

interface SetupOptionsResponse {
  options: Parameters<typeof startRegistration>[0]["optionsJSON"]
  userId: string
}

interface SetupVerifyResponse {
  user: { id: string; email: string; display_name: string }
  backup_codes: Array<string>
}

interface TotpEnrollResponse {
  otpauthUrl: string
  secret: string
}

export const Route = createFileRoute("/_public/setup")({
  validateSearch: (search): SetupSearch => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: async ({ deps }) => {
    if (deps.token) return { devToken: null as string | null }
    try {
      const { token: devToken } = await apiFetch<{ token: string }>(
        "/auth/setup/dev-token"
      )
      return { devToken }
    } catch {
      return { devToken: null as string | null }
    }
  },
  component: SetupPage,
})

function SetupPage(): React.JSX.Element {
  const router = useRouter()
  const { token } = Route.useSearch()
  const { devToken } = Route.useLoaderData()
  const effectiveToken = token ?? devToken ?? undefined

  const [step, setStep] = React.useState<"form" | "totp" | "codes">("form")
  const [email, setEmail] = React.useState("")
  const [displayName, setDisplayName] = React.useState("")
  const [deviceName, setDeviceName] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [backupCodes, setBackupCodes] = React.useState<Array<string>>([])
  const [acknowledged, setAcknowledged] = React.useState(false)

  const [totpData, setTotpData] = React.useState<TotpEnrollResponse | null>(
    null
  )
  const [totpEnrolling, setTotpEnrolling] = React.useState(false)
  const [totpCode, setTotpCode] = React.useState("")
  const [totpVerifying, setTotpVerifying] = React.useState(false)
  const [totpError, setTotpError] = React.useState<string | null>(null)
  const [totpCopied, setTotpCopied] = React.useState(false)
  const totpEnrollStarted = React.useRef(false)

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!effectiveToken) {
      setError(
        "Setup token missing. Open the URL printed in the API logs at first boot."
      )
      return
    }
    setLoading(true)
    setError(null)
    try {
      const { options, userId } = await apiFetch<SetupOptionsResponse>(
        "/auth/setup/options",
        {
          method: "POST",
          body: {
            token: effectiveToken,
            email: email.trim(),
            display_name: displayName.trim(),
          },
        }
      )

      const credential = await startRegistration({ optionsJSON: options })

      const verified = await apiFetch<SetupVerifyResponse>(
        "/auth/setup/verify",
        {
          method: "POST",
          body: {
            userId,
            credential,
            device_name: deviceName.trim() || undefined,
          },
        }
      )

      setBackupCodes(verified.backup_codes)
      setStep("totp")
      toast.success("Admin account created")
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Setup failed — check API logs"
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    if (step !== "totp" || totpData || totpEnrollStarted.current) return
    let cancelled = false
    totpEnrollStarted.current = true
    setTotpEnrolling(true)
    setTotpError(null)
    void (async () => {
      try {
        const data = await apiFetch<TotpEnrollResponse>("/auth/totp/enroll", {
          method: "POST",
        })
        if (!cancelled) setTotpData(data)
      } catch (err) {
        if (cancelled) return
        const msg =
          err instanceof Error ? err.message : "Failed to start TOTP enrollment"
        setTotpError(msg)
        totpEnrollStarted.current = false
      } finally {
        if (!cancelled) setTotpEnrolling(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [step, totpData])

  const handleTotpVerify = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!/^\d{6}$/.test(totpCode)) {
      setTotpError("Enter the 6-digit code from your authenticator app")
      return
    }
    setTotpVerifying(true)
    setTotpError(null)
    try {
      await apiFetch("/auth/totp/verify", {
        method: "POST",
        body: { code: totpCode },
      })
      toast.success("TOTP enabled")
      setStep("codes")
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Invalid TOTP code"
      setTotpError(msg)
      toast.error(msg)
    } finally {
      setTotpVerifying(false)
    }
  }

  const handleCopyTotpSecret = async (): Promise<void> => {
    if (!totpData) return
    try {
      await navigator.clipboard.writeText(totpData.secret)
      setTotpCopied(true)
      setTimeout(() => setTotpCopied(false), 2000)
    } catch {
      toast.error("Clipboard unavailable")
    }
  }

  const handleFinish = async (): Promise<void> => {
    try {
      const me = await apiFetch<Me>("/me")
      const target = me.default_organization
        ? organizationDashboardPath(me.default_organization.slug)
        : "/dashboard"
      await router.navigate({ href: target })
    } catch {
      await router.navigate({ to: "/login" })
    }
  }

  if (!effectiveToken && step === "form") {
    return (
      <Shell title="Setup token required">
        <Alert variant="destructive">
          <AlertDescription>
            This page expects a one-shot setup token in the URL. Look for the
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">
              Open: …/setup?token=…
            </code>
            banner in the API logs of the freshly-started instance, then open
            that URL.
          </AlertDescription>
        </Alert>
      </Shell>
    )
  }

  if (step === "totp") {
    return (
      <Shell
        title="Enable two-factor authentication"
        subtitle="Scan the QR code with your authenticator app, then enter the 6-digit code. This step is required."
      >
        {totpEnrolling || !totpData ? (
          <p className="text-sm text-muted-foreground">
            {totpError ?? "Generating your TOTP secret…"}
          </p>
        ) : (
          <form
            onSubmit={(e) => void handleTotpVerify(e)}
            className="flex flex-col gap-4"
          >
            <div className="flex justify-center">
              <div className="rounded-lg border border-border bg-white p-3">
                <QRCodeSVG value={totpData.otpauthUrl} size={180} />
              </div>
            </div>
            <div className="space-y-1">
              <p className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
                Manual entry
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded border border-border bg-muted px-2 py-1.5 font-mono text-xs">
                  {totpData.secret}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleCopyTotpSecret()}
                  className="shrink-0 font-mono text-[11px]"
                >
                  {totpCopied ? "Copied!" : "Copy"}
                </Button>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="totp_code">Verification code</Label>
              <Input
                id="totp_code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={totpCode}
                onChange={(e) =>
                  setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="000000"
                className="text-center font-mono text-lg tracking-[0.4em]"
                required
              />
            </div>
            {totpError && (
              <Alert variant="destructive">
                <AlertDescription>{totpError}</AlertDescription>
              </Alert>
            )}
            <Button
              type="submit"
              disabled={totpVerifying || !/^\d{6}$/.test(totpCode)}
              className="w-full"
            >
              {totpVerifying ? "Verifying…" : "Verify and continue"}
            </Button>
          </form>
        )}
      </Shell>
    )
  }

  if (step === "codes") {
    return (
      <Shell
        title="Save your backup codes"
        subtitle="One-shot recovery codes — they will not be shown again."
      >
        <div className="rounded-md border border-border bg-muted/40 p-4 font-mono text-sm">
          <ul className="grid grid-cols-2 gap-2">
            {backupCodes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ul>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={() => downloadBackupCodes(backupCodes, email)}
          >
            Download .txt
          </Button>
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={() => void copyBackupCodes(backupCodes)}
          >
            Copy
          </Button>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />
          I have saved these codes in a safe place
        </label>
        <Button
          className="w-full"
          disabled={!acknowledged}
          onClick={() => void handleFinish()}
        >
          Continue to dashboard
        </Button>
      </Shell>
    )
  }

  return (
    <Shell
      title="Configure your Ploydok instance"
      subtitle="Create the first admin account. This screen disappears for good once done."
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="flex flex-col gap-4"
      >
        <div className="space-y-1">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            placeholder="you@example.com"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="display_name">Display name</Label>
          <Input
            id="display_name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            autoComplete="name"
            placeholder="Kevin"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="device_name">Device name (optional)</Label>
          <Input
            id="device_name"
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            placeholder="MacBook personnel"
          />
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" disabled={loading} className="w-full">
          {loading ? "Creating passkey…" : "Create admin and passkey"}
        </Button>
      </form>
    </Shell>
  )
}

function buildBackupCodesText(codes: Array<string>, email: string): string {
  const header = [
    "Ploydok backup codes",
    email ? `Account: ${email}` : null,
    `Generated: ${new Date().toISOString()}`,
    "Each code is single-use. Store in a password manager or print and lock away.",
    "",
  ].filter(Boolean) as Array<string>
  return [...header, ...codes].join("\n") + "\n"
}

function downloadBackupCodes(codes: Array<string>, email: string): void {
  const text = buildBackupCodesText(codes, email)
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = "ploydok-backup-codes.txt"
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

async function copyBackupCodes(codes: Array<string>): Promise<void> {
  try {
    await navigator.clipboard.writeText(codes.join("\n"))
    toast.success("Backup codes copied")
  } catch {
    toast.error("Clipboard unavailable — use the download instead")
  }
}

interface ShellProps {
  title: string
  subtitle?: string
  children: React.ReactNode
}

function Shell({ title, subtitle, children }: ShellProps): React.JSX.Element {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4 text-foreground">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-10 items-center justify-center rounded-[10px] bg-primary text-base font-bold text-primary-foreground">
            P
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl leading-tight font-semibold tracking-tight">
              {title}
            </h1>
            {subtitle && (
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            )}
          </div>
        </div>
        <div className="space-y-4 rounded-[10px] border border-border bg-card p-5 shadow-[0_0_2.5px_1px_var(--border)]">
          {children}
        </div>
      </div>
    </div>
  )
}
