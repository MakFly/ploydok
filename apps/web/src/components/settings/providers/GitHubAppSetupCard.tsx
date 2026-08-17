// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"
import { useImportGitHubApp } from "../../../lib/github"
import type { ImportGitHubAppPayload } from "../../../lib/github"

interface GitHubAppSetupCardProps {
  isPending: boolean
  onCreate: () => void
  onImported: () => void
  error: string | null
  mode?: "setup" | "reconnect"
}

/**
 * Instance-level GitHub App setup: create one through the manifest flow, or
 * reconnect an existing App after a local DB reset. Rendered both by the
 * settings panel and by the onboarding wizard.
 */
export function GitHubAppSetupCard({
  isPending,
  onCreate,
  onImported,
  error,
  mode = "setup",
}: GitHubAppSetupCardProps): React.JSX.Element {
  const importApp = useImportGitHubApp()
  const [showImport, setShowImport] = React.useState(mode === "reconnect")
  const [form, setForm] = React.useState<ImportGitHubAppPayload>({
    appId: "",
    clientId: "",
    clientSecret: "",
    privateKey: "",
    webhookSecret: "",
    slug: "",
    name: "",
  })
  const importError = importApp.error?.message ?? null
  const canImport = Boolean(
    form.appId.trim() &&
    form.clientId.trim() &&
    form.clientSecret.trim() &&
    form.privateKey.trim() &&
    form.slug.trim() &&
    form.name.trim()
  )

  const updateField =
    (key: keyof ImportGitHubAppPayload) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((current) => ({ ...current, [key]: event.target.value }))
    }

  async function handleImport(
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> {
    event.preventDefault()
    await importApp.mutateAsync({
      ...form,
      appId: form.appId.trim(),
      clientId: form.clientId.trim(),
      slug: form.slug.trim(),
      name: form.name.trim(),
      clientSecret: form.clientSecret.trim(),
      privateKey: form.privateKey.trim(),
      webhookSecret: form.webhookSecret?.trim() ?? "",
    })
    onImported()
  }

  return (
    <div className="flex flex-col items-start gap-4">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-full bg-muted">
          <GitHubIcon className="size-5 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium">
            {mode === "reconnect"
              ? "Reconnect the GitHub App"
              : "No GitHub App configured"}
          </p>
          <p className="text-xs text-muted-foreground">
            {mode === "reconnect"
              ? "Replace the unreadable local credentials with the values from the existing GitHub App."
              : "Create a new GitHub App, or reconnect the existing one after a local DB reset."}
          </p>
        </div>
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {mode === "setup" && (
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={onCreate}
            size="sm"
            loading={isPending}
            disabled={importApp.isPending}
          >
            {isPending ? "Redirecting to GitHub..." : "Create GitHub App"}
          </Button>
          <Button
            type="button"
            onClick={() => setShowImport((value) => !value)}
            size="sm"
            variant="outline"
            disabled={isPending || importApp.isPending}
          >
            Reconnect existing App
          </Button>
        </div>
      )}
      {showImport && (
        <form
          className="grid w-full gap-3 border-t border-border pt-4 md:grid-cols-2"
          onSubmit={(event) => void handleImport(event)}
        >
          <label className="flex flex-col gap-1.5 text-xs font-medium">
            App ID
            <Input
              value={form.appId}
              onChange={updateField("appId")}
              inputMode="numeric"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium">
            Client ID
            <Input value={form.clientId} onChange={updateField("clientId")} />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium">
            App slug
            <Input
              value={form.slug}
              onChange={updateField("slug")}
              placeholder="ploydok-local"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium">
            App name
            <Input
              value={form.name}
              onChange={updateField("name")}
              placeholder="Ploydok Local"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium md:col-span-2">
            Client secret
            <Input
              value={form.clientSecret}
              onChange={updateField("clientSecret")}
              type="password"
              autoComplete="off"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium md:col-span-2">
            Private key
            <Textarea
              value={form.privateKey}
              onChange={updateField("privateKey")}
              rows={7}
              autoComplete="off"
              placeholder="-----BEGIN RSA PRIVATE KEY-----"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium md:col-span-2">
            Webhook secret
            <Input
              value={form.webhookSecret}
              onChange={updateField("webhookSecret")}
              type="password"
              autoComplete="off"
              placeholder="Optional for local recovery"
            />
          </label>
          {importError && (
            <p className="text-sm text-destructive md:col-span-2" role="alert">
              {importError}
            </p>
          )}
          <div className="flex justify-end md:col-span-2">
            <Button
              size="sm"
              type="submit"
              loading={importApp.isPending}
              disabled={!canImport}
            >
              {importApp.isPending ? "Reconnecting..." : "Save existing App"}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

export function GitHubIcon({
  className,
}: {
  className?: string
}): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  )
}
