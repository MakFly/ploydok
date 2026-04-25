// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
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

function ApiTokensPage(): React.JSX.Element {
  const qc = useQueryClient()
  const { data: tokens = [], isLoading } = useQuery({
    queryKey: ["api-tokens"],
    queryFn: listApiTokens,
  })

  const [name, setName] = React.useState("")
  const [ttl, setTtl] = React.useState<number | null>(90)
  const [lastCreated, setLastCreated] = React.useState<string | null>(null)

  const create = useMutation({
    mutationFn: () => createApiToken({ name, expiresInDays: ttl ?? undefined }),
    onSuccess: (res) => {
      setLastCreated(res.token)
      setName("")
      qc.invalidateQueries({ queryKey: ["api-tokens"] })
    },
  })
  const revoke = useMutation({
    mutationFn: (id: string) => revokeApiToken(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-tokens"] }),
  })

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
            Le token en clair n'apparaît qu'une fois. Notez-le tout de suite.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
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
            <Button
              disabled={!name.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? "Generating…" : "Generate"}
            </Button>
          </div>
          {lastCreated ? (
            <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
              <p className="font-medium">New token (copy now, shown once) :</p>
              <code className="mt-1 block rounded bg-background p-2 font-mono text-[11px] break-all">
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
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      Created {relative(t.created_at)} · last used{" "}
                      {relative(t.last_used_at)} ·{" "}
                      {t.revoked_at ? "revoked" : "active"}
                    </p>
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
