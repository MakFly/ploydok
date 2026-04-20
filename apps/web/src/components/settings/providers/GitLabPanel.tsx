// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import {
  RiCheckboxCircleFill,
  RiExternalLinkLine,
  RiGitlabFill,
  RiLink,
  RiLoopRightLine,
} from "@remixicon/react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import {
  gitlabConnectUrl,
  useDeleteGitLabConfig,
  useDisconnectGitLab,
  useGitLabConfig,
  useSaveGitLabConfig,
} from "../../../lib/gitlab"

export function GitLabPanel(): React.JSX.Element {
  const { data: config, isLoading } = useGitLabConfig()
  const save = useSaveGitLabConfig()
  const del = useDeleteGitLabConfig()
  const disconnect = useDisconnectGitLab()

  const justConnected =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("connected") === "1"

  const configured = Boolean(config?.configured)

  return (
    <div className="space-y-6">
      {justConnected ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">
          <RiCheckboxCircleFill className="size-4" />
          <span>Connexion GitLab réussie. Tu peux maintenant lister tes projets.</span>
        </div>
      ) : null}

      {isLoading ? (
        <div className="rounded-xl border border-border bg-card p-5 text-xs text-muted-foreground">
          Chargement…
        </div>
      ) : configured ? (
        <ConfiguredState
          config={config!}
          onReset={() => del.mutate()}
          onDisconnect={() => disconnect.mutate()}
          resetPending={del.isPending}
          disconnectPending={disconnect.isPending}
        />
      ) : (
        <NotConfiguredForm
          onSave={async (values) => {
            await save.mutateAsync(values)
          }}
          pending={save.isPending}
        />
      )}

      <SetupHelp />
    </div>
  )
}

function NotConfiguredForm({
  onSave,
  pending,
}: {
  onSave: (values: {
    instance_url: string
    client_id: string
    client_secret: string
    webhook_secret: string
  }) => Promise<void>
  pending: boolean
}): React.JSX.Element {
  const [instanceUrl, setInstanceUrl] = React.useState("https://gitlab.com")
  const [clientId, setClientId] = React.useState("")
  const [clientSecret, setClientSecret] = React.useState("")
  const [webhookSecret, setWebhookSecret] = React.useState("")

  return (
    <form
      className="rounded-xl border border-border bg-card p-5 space-y-4"
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
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </div>
    </form>
  )
}

function ConfiguredState({
  config,
  onReset,
  onDisconnect,
  resetPending,
  disconnectPending,
}: {
  config: { instance_url?: string; client_id?: string }
  onReset: () => void
  onDisconnect: () => void
  resetPending: boolean
  disconnectPending: boolean
}): React.JSX.Element {
  return (
    <section className="rounded-xl border border-border bg-card p-5 space-y-4">
      <header className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-md border border-border bg-background">
          <RiGitlabFill className="size-5 text-[#fc6d26]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-heading text-base font-medium">GitLab configuré</h2>
            <span className="inline-flex items-center gap-1 font-mono text-[10px] tracking-wide text-emerald-600 uppercase dark:text-emerald-400">
              <RiCheckboxCircleFill className="size-3" />
              Active
            </span>
          </div>
          <p className="truncate font-mono text-[10px] tracking-wide text-muted-foreground">
            {config.instance_url}
          </p>
        </div>
      </header>

      <dl className="grid gap-3 text-xs sm:grid-cols-2">
        <div>
          <dt className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
            Client ID
          </dt>
          <dd className="mt-0.5 font-mono text-xs">{config.client_id ?? "—"}</dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
            Instance
          </dt>
          <dd className="mt-0.5 truncate font-mono text-xs">
            {config.instance_url ?? "—"}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <a href={gitlabConnectUrl()}>
            <RiLink className="size-3.5" />
            Connecter mon compte
          </a>
        </Button>
        <Button variant="outline" onClick={onDisconnect} disabled={disconnectPending}>
          <RiLoopRightLine className={cn("size-3.5", disconnectPending && "animate-spin")} />
          {disconnectPending ? "Déconnexion…" : "Révoquer mes tokens"}
        </Button>
        <Button
          variant="ghost"
          className="text-destructive hover:text-destructive"
          onClick={onReset}
          disabled={resetPending}
        >
          {resetPending ? "Suppression…" : "Supprimer la configuration"}
        </Button>
      </div>
    </section>
  )
}

function SetupHelp(): React.JSX.Element {
  const redirect =
    typeof window !== "undefined"
      ? `${window.location.protocol}//${window.location.host.replace("5173", "3335")}/gitlab/callback`
      : "http://localhost:3335/gitlab/callback"

  return (
    <details className="rounded-xl border border-border bg-card p-5 text-xs">
      <summary className="cursor-pointer font-medium">
        Comment créer l'OAuth app côté GitLab ?
      </summary>
      <div className="mt-3 space-y-3 text-muted-foreground leading-relaxed">
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
            (ou <code className="font-mono">{"{"}instance{"}"}/-/user_settings/applications</code>).
          </li>
          <li>Crée une Application.</li>
          <li>
            Redirect URI :{" "}
            <code className="font-mono text-foreground">{redirect}</code>
          </li>
          <li>
            Scopes : cocher <code className="font-mono">api</code> +{" "}
            <code className="font-mono">read_repository</code>.
          </li>
          <li>
            Copie l'<em>Application ID</em> et le <em>Secret</em>, colle-les dans
            le formulaire ci-dessus.
          </li>
          <li>
            Génère un <em>webhook secret</em> aléatoire (par ex.{" "}
            <code className="font-mono">openssl rand -hex 32</code>) — tu le
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
      {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
    </label>
  )
}
