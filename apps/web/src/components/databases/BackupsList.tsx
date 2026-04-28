// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { useDeleteBackup, useTargetBackups } from "../../lib/backups"
import { RestoreDialog } from "./RestoreDialog"
import type { Backup, BackupTarget } from "../../lib/backups"

interface BackupsListProps {
  target: BackupTarget
  restoreLabel: string
  onBackupNow?: () => void
  backupNowLoading?: boolean
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return "—"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString()
}

function StatusBadge({ status }: { status: Backup["status"] }) {
  const variant: Record<
    Backup["status"],
    "default" | "secondary" | "destructive"
  > = {
    succeeded: "default",
    running: "secondary",
    failed: "destructive",
  }
  return <Badge variant={variant[status]}>{status}</Badge>
}

export function BackupsList({
  target,
  restoreLabel,
  onBackupNow,
  backupNowLoading,
}: BackupsListProps): React.JSX.Element {
  const { data: backups, isLoading } = useTargetBackups(target)
  const deleteBackup = useDeleteBackup(target)
  const [restoreBackup, setRestoreBackup] = React.useState<Backup | null>(null)
  const restoreEnabled = target.kind === "database"

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading backups…</p>
  }

  if (!backups || backups.length === 0) {
    return (
      <div className="py-4 text-sm text-muted-foreground">
        No backups yet.{" "}
        {onBackupNow && (
          <Button
            variant="link"
            className="h-auto px-0"
            onClick={onBackupNow}
            disabled={backupNowLoading}
          >
            Create one now
          </Button>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                Date
              </th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                Destination
              </th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                Size
              </th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                Status
              </th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                Encrypted
              </th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {backups.map((backup) => (
              <tr key={backup.id} className="hover:bg-muted/30">
                <td className="px-3 py-2 tabular-nums">
                  {formatDate(backup.startedAt)}
                </td>
                <td className="px-3 py-2">
                  {backup.destinationKind === "s3"
                    ? "S3-compatible"
                    : "Local"}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {formatSize(backup.sizeBytes)}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={backup.status} />
                  {backup.error && (
                    <span
                      className="ml-2 text-xs text-destructive"
                      title={backup.error}
                    >
                      {backup.error.slice(0, 60)}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {backup.ageEncrypted ? "age" : "—"}
                </td>
                <td className="flex items-center gap-2 px-3 py-2">
                  {restoreEnabled && backup.status === "succeeded" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setRestoreBackup(backup)}
                    >
                      Restore
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => deleteBackup.mutate(backup.id)}
                    disabled={deleteBackup.isPending}
                  >
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {restoreBackup && (
        <RestoreDialog
          backup={restoreBackup}
          databaseId={target.kind === "database" ? target.databaseId : ""}
          databaseName={restoreLabel}
          open
          onOpenChange={(open) => {
            if (!open) setRestoreBackup(null)
          }}
        />
      )}
    </>
  )
}
