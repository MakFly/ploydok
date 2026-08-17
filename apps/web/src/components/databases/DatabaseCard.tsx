// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Link } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import {
  RiAlarmWarningLine,
  RiArrowRightUpLine,
  RiDatabase2Line,
  RiGlobalLine,
  RiPlugLine,
  RiShieldCheckLine,
} from "@remixicon/react"
import {
  organizationPath,
  useCurrentOrganizationSlug,
} from "../../lib/organizations"
import {
  isDatabaseBackupScheduled,
  isDatabaseProtected,
} from "../../lib/database-list"
import { DatabaseStatusBadge } from "./DatabaseStatusBadge"
import type { Database } from "../../lib/databases"

const KIND_LABELS: Record<string, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  mariadb: "MariaDB",
  redis: "Redis",
  mongo: "MongoDB",
  libsql: "SQLite / libSQL",
}

interface DatabaseCardProps {
  database: Database
}

function formatRelativeBackupDate(value: string | null | undefined): string {
  if (!value) return "No backup completed"

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Backup date unavailable"

  return `Last backup ${new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)}`
}

function ProtectionBadge({
  database,
}: {
  database: Database
}): React.JSX.Element {
  if (database.management_mode === "external") {
    return <Badge variant="outline">External policy</Badge>
  }

  if (database.latest_backup_status === "failed") {
    return (
      <Badge variant="destructive">
        <RiAlarmWarningLine />
        Backup failed
      </Badge>
    )
  }

  if (isDatabaseProtected(database)) {
    return (
      <Badge
        variant="outline"
        className="border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      >
        <RiShieldCheckLine />
        Last backup succeeded
      </Badge>
    )
  }

  if (isDatabaseBackupScheduled(database)) {
    return (
      <Badge
        variant="outline"
        className="border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400"
      >
        <RiShieldCheckLine />
        Backup scheduled
      </Badge>
    )
  }

  return (
    <Badge variant="destructive">
      <RiAlarmWarningLine />
      No backup
    </Badge>
  )
}

export function DatabaseCard({
  database,
}: DatabaseCardProps): React.JSX.Element {
  const currentOrgSlug = useCurrentOrganizationSlug()
  const detailPath = currentOrgSlug
    ? organizationPath(currentOrgSlug, `databases/${database.id}`)
    : `/databases/${database.id}`

  const kindLabel = KIND_LABELS[database.kind] ?? database.kind
  const versionLabel =
    database.management_mode === "external"
      ? kindLabel
      : `${kindLabel} ${database.version}`
  const sourceLabel =
    database.management_mode === "external" ? "External" : database.plan
  const endpoint = database.host
    ? `${database.host}:${database.port ?? "—"}`
    : "Endpoint pending"
  const linked = database.linked_apps?.length ?? 0
  const backupFailed = database.latest_backup_status === "failed"

  return (
    <article className="group overflow-hidden rounded-xl border border-panel-border bg-panel-inset shadow-sm transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-muted-foreground/30 hover:bg-accent/20 motion-reduce:hover:translate-y-0">
      <Link
        to={detailPath as never}
        className="block p-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground">
              <RiDatabase2Line className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">
                {database.name}
              </p>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {versionLabel} · {sourceLabel}
              </p>
            </div>
          </div>
          <DatabaseStatusBadge
            status={database.status}
            health={database.health_status}
            className="flex-col items-end sm:flex-row"
          />
        </div>

        <div className="mt-4 grid gap-2.5 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <RiPlugLine className="size-4 shrink-0" />
            <span className="truncate font-mono">{endpoint}</span>
          </div>
          <div className="flex items-center gap-2">
            <RiGlobalLine className="size-4 shrink-0" />
            <span className={database.public_enabled ? "text-destructive" : ""}>
              {database.public_enabled ? "Publicly exposed" : "Internal only"}
            </span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <ProtectionBadge database={database} />
          <Badge variant="outline">
            {linked > 0
              ? `${linked} linked app${linked > 1 ? "s" : ""}`
              : "No linked app"}
          </Badge>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4">
          <span
            className={[
              "truncate text-xs",
              backupFailed ? "text-destructive" : "text-muted-foreground",
            ].join(" ")}
          >
            {backupFailed
              ? "Latest backup failed"
              : database.management_mode === "external"
                ? "Backups managed externally"
                : formatRelativeBackupDate(database.latest_backup_at)}
          </span>
          <RiArrowRightUpLine className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </div>
      </Link>
    </article>
  )
}
