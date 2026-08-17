// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { RiExternalLinkLine, RiGitlabFill } from "@remixicon/react"
import { Button } from "@workspace/ui/components/button"
import type { SaveGitLabConfigPayload } from "../../../lib/gitlab"

/**
 * Instance-level GitLab OAuth app credentials. Rendered both by the settings
 * panel and by the onboarding wizard.
 */
export function GitLabConfigForm({
  onSave,
  pending,
}: {
  onSave: (values: Required<SaveGitLabConfigPayload>) => Promise<void>
  pending: boolean
}): React.JSX.Element {
  const [instanceUrl, setInstanceUrl] = React.useState("https://gitlab.com")
  const [clientId, setClientId] = React.useState("")
  const [clientSecret, setClientSecret] = React.useState("")
  const [webhookSecret, setWebhookSecret] = React.useState("")

  return (
    <form
      className="space-y-4 rounded-2xl rounded-xl bg-panel p-5"
      onSubmit={(e) => {
        e.preventDefault()
        void onSave({
          instance_url: instanceUrl,
          client_id: clientId,
          client_secret: clientSecret,
          webhook_secret: webhookSecret,
        })
      }}
    >
      <header className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-md border border-border bg-background">
          <RiGitlabFill className="size-5 text-[#fc6d26]" />
        </div>
        <div>
          <h2 className="font-heading text-base font-medium">
            Créer l'OAuth app
          </h2>
          <p className="text-xs text-muted-foreground">
            Enregistre l'application côté GitLab puis colle les credentials ici.
          </p>
        </div>
      </header>

      <FieldInput
        label="Instance URL"
        hint="gitlab.com ou URL de ton instance self-hosted."
        value={instanceUrl}
        onChange={setInstanceUrl}
        type="url"
        placeholder="https://gitlab.com"
        required
      />
      <FieldInput
        label="Application ID (client_id)"
        value={clientId}
        onChange={setClientId}
        placeholder="ex : 4a2b…"
        required
      />
      <FieldInput
        label="Secret (client_secret)"
        value={clientSecret}
        onChange={setClientSecret}
        type="password"
        placeholder="gloas-…"
        required
      />
      <FieldInput
        label="Webhook secret (X-Gitlab-Token)"
        hint="Secret partagé que tu colleras dans chaque webhook GitLab projet."
        value={webhookSecret}
        onChange={setWebhookSecret}
        type="password"
        required
      />

      <div className="flex justify-end gap-2 pt-1">
        <Button type="submit" loading={pending}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </div>
    </form>
  )
}

/**
 * `callbackUrl` must be the exact value the API sends as `redirect_uri`, so it
 * comes from GET /gitlab/config rather than being guessed from the browser
 * location. GitLab rejects the token exchange on any mismatch.
 */
export function GitLabSetupHelp({
  callbackUrl,
}: {
  callbackUrl: string | undefined
}): React.JSX.Element {
  return (
    <details className="rounded-2xl rounded-xl bg-panel p-5 text-xs">
      <summary className="cursor-pointer font-medium">
        Comment créer l'OAuth app côté GitLab ?
      </summary>
      <div className="mt-3 space-y-3 leading-relaxed text-muted-foreground">
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            Ouvre{" "}
            <a
              href="https://gitlab.com/-/user_settings/applications"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-foreground underline-offset-2 hover:underline"
            >
              GitLab → Préférences → Applications
              <RiExternalLinkLine className="size-3" />
            </a>{" "}
            (ou{" "}
            <code className="font-mono">
              {"{"}instance{"}"}/-/user_settings/applications
            </code>
            ).
          </li>
          <li>Crée une Application.</li>
          <li>
            Redirect URI :{" "}
            {callbackUrl ? (
              <code className="font-mono text-foreground">{callbackUrl}</code>
            ) : (
              <span className="text-muted-foreground">chargement…</span>
            )}
          </li>
          <li>
            Scopes : cocher <code className="font-mono">api</code> +{" "}
            <code className="font-mono">read_repository</code>.
          </li>
          <li>
            Copie l'<em>Application ID</em> et le <em>Secret</em>, colle-les
            dans le formulaire ci-dessus.
          </li>
          <li>
            Génère un <em>webhook secret</em> aléatoire (par ex.{" "}
            <code className="font-mono">openssl rand -hex 32</code>), tu le
            colleras dans chaque webhook GitLab projet.
          </li>
        </ol>
      </div>
    </details>
  )
}

function FieldInput({
  label,
  hint,
  value,
  onChange,
  type = "text",
  placeholder,
  required,
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  required?: boolean
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        placeholder={placeholder}
        required={required}
        className="rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
      />
      {hint ? (
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  )
}
