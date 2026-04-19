// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Link, createFileRoute, useRouter } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { toast } from "sonner"
import { PasskeyButton } from "../../components/auth/PasskeyButton"

export const Route = createFileRoute("/_public/login")({
  component: LoginPage,
})

function LoginPage(): React.JSX.Element {
  const router = useRouter()
  const [backupMode, setBackupMode] = React.useState(false)

  const handlePasskeySuccess = (): void => {
    void router.navigate({ to: "/dashboard" })
  }

  return (
    <div className="bg-background text-foreground flex min-h-svh items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="bg-primary text-primary-foreground flex size-10 items-center justify-center rounded-[10px] text-base font-bold">
            P
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl leading-tight font-semibold tracking-tight">
              Welcome back
            </h1>
            <p className="text-muted-foreground text-sm">
              Sign in to your Ploydok workspace.
            </p>
          </div>
        </div>

        <div className="bg-card border-border rounded-[10px] border p-5 shadow-[0_0_2.5px_1px_var(--border)]">
          {!backupMode ? (
            <PasskeyModePanel
              onSuccess={handlePasskeySuccess}
              onSwitchBackup={() => setBackupMode(true)}
            />
          ) : (
            <BackupCodePanel
              onSuccess={handlePasskeySuccess}
              onBack={() => setBackupMode(false)}
            />
          )}
        </div>

        <div className="text-muted-foreground flex flex-col items-center gap-2 text-center text-xs">
          <p>
            Pas encore de compte ?{" "}
            <Link
              to="/register"
              className="text-foreground font-medium underline-offset-4 hover:underline"
            >
              Créer un compte
            </Link>
          </p>
          <p className="font-mono text-[10px] tracking-wide uppercase">
            AGPL-3.0 · self-hosted
          </p>
        </div>
      </div>
    </div>
  )
}

function PasskeyModePanel({
  onSuccess,
  onSwitchBackup,
}: {
  onSuccess: () => void
  onSwitchBackup: () => void
}): React.JSX.Element {
  return (
    <div className="space-y-4">
      <PasskeyButton onSuccess={onSuccess} />
      <div className="relative">
        <div className="border-border absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-card text-muted-foreground px-2 font-mono text-[10px] tracking-wide uppercase">
            or
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={onSwitchBackup}
        className="text-muted-foreground hover:text-foreground block w-full text-center text-xs underline-offset-2 hover:underline"
      >
        Use backup code instead
      </button>
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
      const res = await fetch(
        `${import.meta.env.VITE_API_URL ?? "http://localhost:3335"}/auth/backup-codes/consume`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, code }),
        },
      )
      if (!res.ok) {
        const data = (await res.json()) as { error?: { message?: string } }
        throw new Error(data.error?.message ?? "Invalid backup code")
      }
      toast.success("Signed in")
      onSuccess()
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
        <p className="text-muted-foreground text-xs">
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
          className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
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
          Back to passkey login
        </Button>
      </div>
    </form>
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
      <label
        htmlFor={id}
        className="text-muted-foreground text-xs font-medium"
      >
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
          "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/40 placeholder:text-muted-foreground/60 flex h-9 w-full rounded-md border px-3 text-sm transition-colors outline-none focus-visible:ring-3" +
          (mono ? " font-mono tracking-wider uppercase" : "")
        }
      />
    </div>
  )
}
