// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { RiDatabase2Line, RiDeleteBinLine, RiEyeLine } from "@remixicon/react"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import { useDeleteSecret } from "../../lib/secrets"
import type { SecretMeta, SecretPhase, SecretScope } from "../../lib/secrets"

interface SecretsTableProps {
  appId: string
  scope: SecretScope
  secrets: Array<SecretMeta>
  onReveal: (key: string, scope: SecretScope, phase: SecretPhase) => void
}

export function SecretsTable({
  appId,
  scope,
  secrets,
  onReveal,
}: SecretsTableProps): React.JSX.Element {
  const { mutate: deleteSecret, isPending: isDeleting } = useDeleteSecret(appId)

  if (secrets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-10 text-center">
        <p className="text-sm text-muted-foreground">
          No secrets for scope <Badge variant="outline">{scope}</Badge>
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
              Key
            </th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
              Phase
            </th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
              Source
            </th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
              Updated
            </th>
            <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {secrets.map((secret) => (
            <tr
              key={`${secret.key}-${secret.scope}-${secret.phase}`}
              className="hover:bg-muted/20"
            >
              <td className="px-4 py-3 font-mono text-xs">{secret.key}</td>
              <td className="px-4 py-3 text-xs">
                <Badge variant="secondary">{secret.phase}</Badge>
              </td>
              <td className="px-4 py-3 text-xs">
                {secret.managed_by === "database" ? (
                  <Badge variant="outline" className="gap-1">
                    <RiDatabase2Line className="size-3" />
                    {secret.linked_database_name ?? "Database link"}
                  </Badge>
                ) : (
                  <Badge variant="secondary">Manual</Badge>
                )}
              </td>
              <td className="px-4 py-3 text-xs text-muted-foreground">
                {secret.updated_at
                  ? new Date(secret.updated_at).toLocaleDateString()
                  : "—"}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      onReveal(secret.key, secret.scope, secret.phase)
                    }
                    title="Reveal value"
                  >
                    <RiEyeLine className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      deleteSecret({
                        key: secret.key,
                        scope,
                        phase: secret.phase,
                      })
                    }
                    disabled={isDeleting || secret.managed_by === "database"}
                    title={
                      secret.managed_by === "database"
                        ? "Managed by database link"
                        : "Delete secret"
                    }
                  >
                    <RiDeleteBinLine className="size-4 text-destructive" />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
