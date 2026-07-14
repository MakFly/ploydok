// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { toast } from "sonner"
import { apiFetch } from "../../lib/api"
import { apiBaseUrl } from "../../lib/api/base"
import { PasskeyButton } from "../../components/auth/PasskeyButton"
import { organizationDashboardPath } from "../../lib/organizations"
import type { Me } from "@ploydok/shared"

export const Route = createFileRoute("/_public/login")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === "string" ? { redirect: search.redirect } : {},
  component: LoginPage,
})

export function normalizeLoginRedirect(value?: string): string | null {
  if (!value) return null
  if (!value.startsWith("/") || value.startsWith("//")) return null
  try {
    const url = new URL(value, "http://ploydok.local")
    if (url.origin !== "http://ploydok.local") return null
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return null
  }
}

function LoginPage(): React.JSX.Element {
  const router = useRouter()
  const { redirect } = Route.useSearch()
  const [mode, setMode] = React.useState<"password" | "passkey" | "backup">(
    "password"
  )
  const [email, setEmail] = React.useState("")

  const handleAuthSuccess = async (): Promise<void> => {
    const me = await apiFetch<Me>("/me")
    const target =
      normalizeLoginRedirect(redirect) ??
      (me.default_organization
        ? organizationDashboardPath(me.default_organization.slug)
        : "/dashboard")
    await router.navigate({ href: target })
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4 text-foreground">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-10 items-center justify-center rounded-[10px] bg-primary text-base font-bold text-primary-foreground">
            P
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl leading-tight font-semibold tracking-tight">
              Welcome back
            </h1>
            <p className="text-sm text-muted-foreground">
              Sign in to your Ploydok workspace.
            </p>
          </div>
        </div>

        <div className="rounded-[10px] border border-border bg-card p-5 shadow-[0_0_2.5px_1px_var(--border)]">
          {mode === "password" ? (
            <PasswordModePanel
              onSuccess={() => void handleAuthSuccess()}
              onSwitchPasskey={() => setMode("passkey")}
              onSwitchBackup={() => setMode("backup")}
            />
          ) : mode === "passkey" ? (
            <PasskeyModePanel
              email={email}
              onEmailChange={setEmail}
              onSuccess={() => void handleAuthSuccess()}
              onSwitchPassword={() => setMode("password")}
              onSwitchBackup={() => setMode("backup")}
            />
          ) : (
            <BackupCodePanel
              onSuccess={handleAuthSuccess}
              onBack={() => setMode("password")}
            />
          )}
        </div>

        <div className="flex flex-col items-center gap-2 text-center text-xs text-muted-foreground">
          <p className="font-mono text-[10px] tracking-wide uppercase">
            AGPL-3.0 · self-hosted
          </p>
        </div>
      </div>
    </div>
  )
}

function PasswordModePanel({
  onSuccess,
  onSwitchPasskey,
  onSwitchBackup,
}: {
  onSuccess: () => void
  onSwitchPasskey: () => void
  onSwitchBackup: () => void
}): React.JSX.Element {
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await apiFetch("/auth/login/password", {
        method: "POST",
        body: { email, password },
      })
      toast.success("Signed in")
      onSuccess()
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Authentication failed"
      toast.error(msg)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
      <Field
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={setEmail}
        placeholder="you@example.com"
      />
      <Field
        id="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={setPassword}
        placeholder="Your password"
      />
      {error && (
        <p
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}
      <Button type="submit" disabled={loading} size="lg" className="w-full">
        {loading ? "Signing in…" : "Sign in"}
      </Button>
      <AuthSwitches
        primaryLabel="Use passkey instead"
        onPrimary={onSwitchPasskey}
        secondaryLabel="Use backup code"
        onSecondary={onSwitchBackup}
      />
    </form>
  )
}

function PasskeyModePanel({
  email,
  onEmailChange,
  onSuccess,
  onSwitchPassword,
  onSwitchBackup,
}: {
  email: string
  onEmailChange: (value: string) => void
  onSuccess: () => void
  onSwitchPassword: () => void
  onSwitchBackup: () => void
}): React.JSX.Element {
  return (
    <div className="space-y-4">
      <Field
        id="passkey-email"
        label="Email"
        type="email"
        autoComplete="email webauthn"
        value={email}
        onChange={onEmailChange}
        placeholder="you@example.com"
      />
      <PasskeyButton email={email} onSuccess={onSuccess} />
      <AuthSwitches
        primaryLabel="Use password instead"
        onPrimary={onSwitchPassword}
        secondaryLabel="Use backup code"
        onSecondary={onSwitchBackup}
      />
    </div>
  )
}

function BackupCodePanel({
  onSuccess,
  onBack,
}: {
  onSuccess: () => void
  onBack: () => void
}): React.JSX.Element {
  const [email, setEmail] = React.useState("")
  const [code, setCode] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${apiBaseUrl()}/auth/backup-codes/consume`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: { message?: string } }
        throw new Error(data.error?.message ?? "Invalid backup code")
      }
      toast.success("Signed in")
      void onSuccess()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed")
      setError(err instanceof Error ? err.message : "Authentication failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-sm font-medium">Sign in with backup code</h2>
        <p className="text-xs text-muted-foreground">
          Use one of the backup codes you saved when setting up your passkey.
        </p>
      </div>
      <Field
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={setEmail}
        placeholder="you@example.com"
      />
      <Field
        id="code"
        label="Backup code"
        autoComplete="one-time-code"
        mono
        value={code}
        onChange={(v) => setCode(v.toUpperCase())}
        placeholder="XXXX-XXXX-XXXX"
      />
      {error && (
        <p
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}
      <div className="space-y-2">
        <Button type="submit" disabled={loading} size="lg" className="w-full">
          {loading ? "Signing in…" : "Sign in"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="w-full"
        >
          Back to password login
        </Button>
      </div>
    </form>
  )
}

function AuthSwitches({
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
}: {
  primaryLabel: string
  onPrimary: () => void
  secondaryLabel: string
  onSecondary: () => void
}): React.JSX.Element {
  return (
    <div className="space-y-3">
      <div className="relative">
        <div className="absolute inset-0 flex items-center border-border">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-card px-2 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
            or
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onPrimary}
          className="h-auto py-2 text-center text-xs whitespace-normal"
        >
          {primaryLabel}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onSecondary}
          className="h-auto py-2 text-center text-xs whitespace-normal"
        >
          {secondaryLabel}
        </Button>
      </div>
    </div>
  )
}

interface FieldProps {
  id: string
  label: string
  type?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoComplete?: string
  mono?: boolean
}

function Field({
  id,
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  autoComplete,
  mono = false,
}: FieldProps): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        autoComplete={autoComplete}
        placeholder={placeholder}
        className={
          "flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm transition-colors outline-none placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40" +
          (mono ? " font-mono tracking-wider uppercase" : "")
        }
      />
    </div>
  )
}
