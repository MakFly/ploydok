// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { ALL_SCOPES, type ApiTokenScope } from "@ploydok/shared"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { ShellPage } from "../../../components/layout/AppShell"
import { SettingsTabs } from "../../../components/settings/SettingsTabs"
import {
  listApiTokens,
  createApiToken,
  revokeApiToken,
} from "../../../lib/api-tokens"

export const Route = createFileRoute("/_authed/settings/api-tokens")({
  component: ApiTokensPage,
})

function relative(iso: string | Date | null | undefined): string {
  if (!iso) return "—"
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3_600_000)
  if (h < 1) return `${Math.floor(diff / 60_000)}m ago`
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const DEFAULT_SCOPES: ApiTokenScope[] = ["admin:*"]

function ApiTokensPage(): React.JSX.Element {
  const qc = useQueryClient()
  const { data: tokens = [], isLoading } = useQuery({
    queryKey: ["api-tokens"],
    queryFn: listApiTokens,
  })

  const [name, setName] = React.useState("")
  const [ttl, setTtl] = React.useState<number | null>(90)
  const [scopes, setScopes] = React.useState<ApiTokenScope[]>(DEFAULT_SCOPES)
  const [lastCreated, setLastCreated] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)

  const create = useMutation({
    mutationFn: () =>
      createApiToken({
        name,
        expiresInDays: ttl ?? undefined,
        scopes,
      }),
    onSuccess: (res) => {
      setLastCreated(res.token)
      setName("")
      setScopes(DEFAULT_SCOPES)
      setCopied(false)
      qc.invalidateQueries({ queryKey: ["api-tokens"] })
    },
  })
  const revoke = useMutation({
    mutationFn: (id: string) => revokeApiToken(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-tokens"] }),
  })

  const toggleScope = (scope: ApiTokenScope) => {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    )
  }

  const copyToken = async () => {
    if (!lastCreated) return
    try {
      await navigator.clipboard.writeText(lastCreated)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <ShellPage
      title="API tokens"
      description="Personal Access Tokens pour automatiser Ploydok depuis tes scripts et CI."
      eyebrow="Account"
    >
      <div className="space-y-6">
        <SettingsTabs />

        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-medium">Generate new token</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Le token en clair n'apparaît qu'une fois (préfixe{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
              plk_live_
            </code>
            ). Notez-le ou copiez-le tout de suite.
          </p>

          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[200px] flex-1">
                <label className="mb-1 block text-xs">Name</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="CI deploy bot"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs">Expires in</label>
                <select
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={ttl ?? "never"}
                  onChange={(e) =>
                    setTtl(
                      e.target.value === "never" ? null : Number(e.target.value)
                    )
                  }
                >
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="365">1 year</option>
                  <option value="never">Never</option>
                </select>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-xs">
                Scopes{" "}
                <span className="text-muted-foreground">
                  ({scopes.length} selected)
                </span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {ALL_SCOPES.map((scope) => {
                  const active = scopes.includes(scope)
                  return (
                    <button
                      key={scope}
                      type="button"
                      onClick={() => toggleScope(scope)}
                      aria-pressed={active}
                      className={`inline-flex h-7 items-center rounded-md border px-2.5 font-mono text-[11px] transition-colors ${
                        active
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-background text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {scope}
                    </button>
                  )
                })}
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                <code className="font-mono">admin:*</code> couvre tout.{" "}
                <code className="font-mono">databases:*</code> couvre read +
                write databases. Sinon match exact.
              </p>
            </div>

            <div>
              <Button
                disabled={
                  !name.trim() || scopes.length === 0 || create.isPending
                }
                onClick={() => create.mutate()}
              >
                {create.isPending ? "Generating…" : "Generate"}
              </Button>
            </div>
          </div>

          {lastCreated ? (
            <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">
                  New token (copy now, shown once) :
                </p>
                <button
                  type="button"
                  onClick={() => void copyToken()}
                  className="rounded-md border border-amber-500/40 bg-background px-2 py-1 text-[10px] font-medium hover:bg-muted"
                >
                  {copied ? "Copied ✓" : "Copy"}
                </button>
              </div>
              <code className="mt-2 block rounded bg-background p-2 font-mono text-[11px] break-all">
                {lastCreated}
              </code>
              <button
                type="button"
                className="mt-2 text-xs text-primary underline"
                onClick={() => setLastCreated(null)}
              >
                Dismiss
              </button>
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-medium">Your tokens</h3>
          {isLoading ? (
            <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
          ) : tokens.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Aucun token pour l'instant.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {tokens.map((t) => (
                <li
                  key={t.id}
                  className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate text-sm font-medium">{t.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      Created {relative(t.created_at)} · last used{" "}
                      {relative(t.last_used_at)} ·{" "}
                      {t.revoked_at ? "revoked" : "active"}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {t.scopes.map((s) => (
                        <span
                          key={s}
                          className="inline-flex h-5 items-center rounded border border-border bg-muted/40 px-1.5 font-mono text-[10px] text-muted-foreground"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                  {!t.revoked_at ? (
                    <button
                      type="button"
                      className="text-xs text-destructive hover:underline"
                      onClick={() => revoke.mutate(t.id)}
                    >
                      Revoke
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </ShellPage>
  )
}
