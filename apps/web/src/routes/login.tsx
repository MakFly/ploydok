// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { PasskeyButton } from "../components/auth/PasskeyButton";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage(): React.JSX.Element {
  const router = useRouter();
  const [backupMode, setBackupMode] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const handlePasskeySuccess = (): void => {
    void router.navigate({ to: "/dashboard" });
  };

  const handleBackupCodeSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL ?? "http://localhost:4000"}/auth/backup-codes/consume`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, code }),
        },
      );
      if (!res.ok) {
        const data = (await res.json()) as { error?: { message?: string } };
        throw new Error(data.error?.message ?? "Invalid backup code");
      }
      void router.navigate({ to: "/dashboard" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo / title */}
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">Ploydok</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to your self-hosted PaaS
          </p>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          {!backupMode ? (
            <div className="space-y-4">
              <PasskeyButton onSuccess={handlePasskeySuccess} />
              <div className="text-center">
                <button
                  className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => setBackupMode(true)}
                >
                  Use backup code instead
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={(e) => void handleBackupCodeSubmit(e)} className="space-y-4">
              <h2 className="text-sm font-medium">Sign in with backup code</h2>
              <div className="space-y-2">
                <label htmlFor="email" className="text-xs text-muted-foreground">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="you@example.com"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="code" className="text-xs text-muted-foreground">
                  Backup code
                </label>
                <input
                  id="code"
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  required
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="XXXX-XXXX-XXXX"
                />
              </div>
              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {loading ? "Signing in…" : "Sign in"}
              </button>
              <button
                type="button"
                className="w-full text-xs text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => setBackupMode(false)}
              >
                Back to passkey login
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Pas encore de compte ?{" "}
          <Link to="/register" className="underline">
            Créer un compte
          </Link>
        </p>
        <p className="text-center text-xs text-muted-foreground">
          Ploydok is AGPL-3.0 licensed self-hosted software.
        </p>
      </div>
    </div>
  );
}
