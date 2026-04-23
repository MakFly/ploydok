// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Link, createFileRoute, useRouter } from "@tanstack/react-router"
import { startRegistration } from "@simplewebauthn/browser"
import { apiFetch } from "../../lib/api"
import type { Me } from "@ploydok/shared"
import { toast } from "sonner"
import { organizationDashboardPath } from "../../lib/organizations"

export const Route = createFileRoute("/_public/register")({
  component: RegisterPage,
})

interface RegisterOptionsResponse {
  options: Parameters<typeof startRegistration>[0]["optionsJSON"];
  userId: string;
}

function RegisterPage(): React.JSX.Element {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [deviceName, setDeviceName] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { options, userId } = await apiFetch<RegisterOptionsResponse>(
        "/auth/register/options",
        {
          method: "POST",
          body: { email: email.trim(), display_name: displayName.trim() },
        },
      );

      const credential = await startRegistration({ optionsJSON: options });

      await apiFetch("/auth/register/verify", {
        method: "POST",
        body: {
          userId,
          credential,
          device_name: deviceName.trim() || undefined,
        },
      });

      toast.success("Account created");
      const me = await apiFetch<Me>("/me");
      void router.navigate({
        href: me.default_organization
          ? organizationDashboardPath(me.default_organization.slug)
          : "/dashboard",
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Échec de l'inscription");
      setError(err instanceof Error ? err.message : "Échec de l'inscription");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">Créer un compte</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Ton premier pas sur Ploydok — une passkey, c'est tout.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <Field
              id="email"
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
            <Field
              id="display_name"
              label="Nom affiché"
              value={displayName}
              onChange={setDisplayName}
              placeholder="Kévin"
              required
              autoComplete="name"
            />
            <Field
              id="device_name"
              label="Nom de l'appareil (optionnel)"
              value={deviceName}
              onChange={setDeviceName}
              placeholder="MacBook perso"
              autoComplete="off"
            />
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
              {loading ? "Création de la passkey…" : "Créer une passkey"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Déjà un compte ?{" "}
          <Link to="/login" className="underline">
            Se connecter
          </Link>
        </p>
      </div>
    </div>
  );
}

interface FieldProps {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
}

function Field({ id, label, type = "text", value, onChange, placeholder, required, autoComplete }: FieldProps): React.JSX.Element {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </div>
  );
}
