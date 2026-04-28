// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import {
  RiAddLine,
  RiDeleteBinLine,
  RiLockLine,
  RiShip2Line,
} from "@remixicon/react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"
import { ShellPage } from "../../../components/layout/AppShell"
import {

  useCreateRegistryCredential,
  useDeleteRegistryCredential,
  useRegistryCredentials
} from "../../../lib/registry-credentials"
import type {RegistryCredential} from "../../../lib/registry-credentials";

export const Route = createFileRoute("/_authed/settings/registry")({
  component: RegistryPage,
})

function RegistryPage(): React.JSX.Element {
  const { data: credentials, isLoading } = useRegistryCredentials()
  const [showForm, setShowForm] = React.useState(false)

  return (
    <ShellPage
      title="Registry credentials"
      description="Authentification pour tirer des images depuis un registre Docker privé (Docker Hub, GHCR, GitLab, registry.example.com…)."
      actions={
        !showForm ? (
          <Button size="sm" onClick={() => setShowForm(true)}>
            <RiAddLine className="size-4" />
            New credential
          </Button>
        ) : null
      }
    >
      <div className="space-y-6">
        {showForm ? (
          <CreateCredentialForm onClose={() => setShowForm(false)} />
        ) : null}

        <section aria-label="Credentials">
          {isLoading ? (
            <CredentialListSkeleton />
          ) : !credentials || credentials.length === 0 ? (
            <EmptyState onCreate={() => setShowForm(true)} />
          ) : (
            <CredentialList credentials={credentials} />
          )}
        </section>
      </div>
    </ShellPage>
  )
}

// ---------------------------------------------------------------------------
// Create form
// ---------------------------------------------------------------------------

function CreateCredentialForm({
  onClose,
}: {
  onClose: () => void
}): React.JSX.Element {
  const [label, setLabel] = React.useState("")
  const [registryHost, setRegistryHost] = React.useState("")
  const [username, setUsername] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  const create = useCreateRegistryCredential()

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    if (
      !label.trim() ||
      !registryHost.trim() ||
      !username.trim() ||
      !password
    ) {
      setError("All fields are required")
      return
    }
    try {
      await create.mutateAsync({
        label: label.trim(),
        registryHost: registryHost.trim(),
        username: username.trim(),
        password,
      })
      onClose()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create credential"
      )
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-xl border border-border bg-card p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">New registry credential</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Le mot de passe est chiffré AES-256-GCM côté serveur.
          </p>
        </div>
        <RiLockLine className="size-4 shrink-0 text-muted-foreground" />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Field
          id="reg-label"
          label="Label"
          placeholder="Docker Hub perso"
          value={label}
          onChange={setLabel}
          autoFocus
        />
        <Field
          id="reg-host"
          label="Registry host"
          placeholder="registry.hub.docker.com"
          value={registryHost}
          onChange={setRegistryHost}
        />
        <Field
          id="reg-user"
          label="Username"
          placeholder="alice"
          value={username}
          onChange={setUsername}
        />
        <Field
          id="reg-pass"
          label="Password / token"
          placeholder="••••••••"
          value={password}
          onChange={setPassword}
          type="password"
        />
      </div>

      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={create.isPending}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={create.isPending}>
          {create.isPending ? "Saving…" : "Save credential"}
        </Button>
      </div>
    </form>
  )
}

interface FieldProps {
  id: string
  label: string
  placeholder: string
  value: string
  onChange: (v: string) => void
  type?: "text" | "password"
  autoFocus?: boolean
}

function Field({
  id,
  label,
  placeholder,
  value,
  onChange,
  type = "text",
  autoFocus,
}: FieldProps): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-medium">
        {label}
      </label>
      <Input
        id={id}
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        className="h-9 text-sm"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// List + delete
// ---------------------------------------------------------------------------

function CredentialList({
  credentials,
}: {
  credentials: Array<RegistryCredential>
}): React.JSX.Element {
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-card">
      {credentials.map((c) => (
        <CredentialRow key={c.id} credential={c} />
      ))}
    </ul>
  )
}

function CredentialRow({
  credential,
}: {
  credential: RegistryCredential
}): React.JSX.Element {
  const del = useDeleteRegistryCredential()
  const [confirming, setConfirming] = React.useState(false)

  const handleDelete = (): void => {
    if (!confirming) {
      setConfirming(true)
      return
    }
    del.mutate(credential.id)
  }

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background">
        <RiShip2Line className="size-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{credential.label}</p>
        <p className="truncate font-mono text-[11px] text-muted-foreground">
          {credential.username}@{credential.registryHost}
        </p>
      </div>
      <button
        type="button"
        onClick={handleDelete}
        disabled={del.isPending}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
          confirming
            ? "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15"
            : "border-border bg-background text-muted-foreground hover:text-foreground"
        )}
      >
        <RiDeleteBinLine className="size-3.5" />
        {confirming ? "Confirm" : "Delete"}
      </button>
    </li>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <RiShip2Line className="size-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">No credentials yet</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          Ajoute tes identifiants de registre privé pour déployer une app à
          partir d'une image Docker (source « Image »).
        </p>
      </div>
      <Button size="sm" onClick={onCreate}>
        <RiAddLine className="size-4" />
        New credential
      </Button>
    </div>
  )
}

function CredentialListSkeleton(): React.JSX.Element {
  return (
    <div className="divide-y divide-border rounded-xl border border-border bg-card">
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <div className="size-9 rounded-md bg-muted" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-32 rounded bg-muted" />
            <div className="h-2.5 w-48 rounded bg-muted/60" />
          </div>
          <div className="h-7 w-16 rounded-md bg-muted" />
        </div>
      ))}
    </div>
  )
}
