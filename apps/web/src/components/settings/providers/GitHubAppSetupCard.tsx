// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../i18n/dialog"
import { useImportGitHubApp } from "../../../lib/github"
import { apiBaseUrl } from "../../../lib/api/base"
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
  const reconnectUrls = useReconnectUrls()
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
          <ReconnectGuide
            appSlug={form.slug.trim()}
            apiOrigin={reconnectUrls.apiOrigin}
            webOrigin={reconnectUrls.webOrigin}
          />
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

function useReconnectUrls(): { apiOrigin: string; webOrigin: string } {
  const [origins, setOrigins] = React.useState({
    apiOrigin: "https://<your-ploydok-api>",
    webOrigin: "https://<your-ploydok-instance>",
  })

  React.useEffect(() => {
    const base = apiBaseUrl().replace(/\/$/, "")
    const webOrigin = window.location.origin
    setOrigins({
      apiOrigin: /^https?:\/\//.test(base) ? base : webOrigin,
      webOrigin,
    })
  }, [])

  return origins
}

function ReconnectGuide({
  appSlug,
  apiOrigin,
  webOrigin,
}: {
  appSlug: string
  apiOrigin: string
  webOrigin: string
}): React.JSX.Element {
  const appSettingsUrl = appSlug
    ? `https://github.com/settings/apps/${encodeURIComponent(appSlug)}`
    : "https://github.com/settings/apps"
  const callbackUrl = `${apiOrigin}/github/app/callback`
  const setupUrl = `${apiOrigin}/github/app/setup`
  const webhookUrl = `${apiOrigin}/github/webhook`

  return (
    <Dialog>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background p-3 md:col-span-2">
        <p className="text-xs text-muted-foreground">
          Need help finding the GitHub App credentials?
        </p>
        <DialogTrigger asChild>
          <Button type="button" size="sm" variant="outline">
            How to reconnect
          </Button>
        </DialogTrigger>
      </div>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>How to reconnect the GitHub App</DialogTitle>
          <DialogDescription>
            Open the existing App on GitHub, align its URLs, then generate fresh
            credentials. Existing secrets and private keys cannot be displayed
            again by GitHub.
          </DialogDescription>
        </DialogHeader>

        <ol className="space-y-4 text-xs leading-5">
          <li className="space-y-2">
            <p className="font-medium">1. Open the existing GitHub App</p>
            <p className="text-muted-foreground">
              Use the personal settings page, or open your organization and go
              to Settings → Developer settings → GitHub Apps.
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <a
                href={appSettingsUrl}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                Open personal App settings ↗
              </a>
              <a
                href="https://github.com/settings/organizations"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                Choose an organization ↗
              </a>
            </div>
          </li>

          <li className="space-y-2">
            <p className="font-medium">2. Align the General settings</p>
            <p className="text-muted-foreground">
              Keep OAuth during installation disabled, enable Redirect on
              update, and use these exact values:
            </p>
            <dl className="grid gap-2 rounded-md bg-muted/50 p-3">
              <GuideValue label="Homepage URL" value={webOrigin} />
              <GuideValue label="Callback URL" value={callbackUrl} />
              <GuideValue label="Setup URL" value={setupUrl} />
              <GuideValue label="Webhook URL" value={webhookUrl} />
            </dl>
            {apiOrigin.includes("localhost") ||
            apiOrigin.includes("127.0.0.1") ? (
              <p className="text-muted-foreground">
                GitHub cannot deliver webhooks to localhost. Use the public
                HTTPS URL of your tunnel or deployed API instead of the local
                webhook URL above.
              </p>
            ) : null}
          </li>

          <li className="space-y-2">
            <p className="font-medium">3. Collect the values below</p>
            <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
              <li>
                Copy App ID, Client ID and the App name from General. The slug
                is the last part of the public App URL:
                github.com/apps/&lt;slug&gt;.
              </li>
              <li>
                Under Client secrets, generate a new secret and paste it now.
              </li>
              <li>
                Under Private keys, generate a key, open the downloaded .pem
                file and paste its complete contents, including BEGIN/END lines.
              </li>
              <li>
                If webhooks are active, choose a new webhook secret, save it on
                GitHub, and paste the same value here.
              </li>
            </ul>
          </li>
        </ol>
      </DialogContent>
    </Dialog>
  )
}

function GuideValue({
  label,
  value,
}: {
  label: string
  value: string
}): React.JSX.Element {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[110px_minmax(0,1fr)] sm:gap-3">
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd className="font-mono text-[11px] break-all select-all">{value}</dd>
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
