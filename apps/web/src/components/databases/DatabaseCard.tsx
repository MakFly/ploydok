// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Link } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import {
  RiArrowRightUpLine,
  RiDatabase2Line,
  RiPlugLine,
} from "@remixicon/react"
import {
  organizationPath,
  useCurrentOrganizationSlug,
} from "../../lib/organizations"
import type { Database } from "../../lib/databases"

const KIND_LABELS: Record<string, string> = {
  postgres: "PostgreSQL 16",
  mysql: "MySQL 8.4",
  mariadb: "MariaDB 11.4",
  redis: "Redis 7",
  mongo: "MongoDB 7",
  libsql: "SQLite / libSQL",
}

const STATUS_VARIANTS: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  running: "default",
  creating: "secondary",
  starting: "secondary",
  stopped: "outline",
  degraded: "secondary",
  failed: "destructive",
}

interface DatabaseCardProps {
  database: Database
}

export function DatabaseCard({
  database,
}: DatabaseCardProps): React.JSX.Element {
  const currentOrgSlug = useCurrentOrganizationSlug()
  const detailPath = currentOrgSlug
    ? organizationPath(currentOrgSlug, `databases/${database.id}`)
    : `/databases/${database.id}`

  const kindLabel = KIND_LABELS[database.kind] ?? database.kind
  const endpoint = database.host
    ? `${database.host}:${database.port ?? "—"}`
    : "Endpoint pending"
  const linked = database.linked_apps?.length ?? 0

  return (
    <Link
      to={detailPath as never}
      className="group rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/20 hover:bg-accent/30"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">
            {database.name}
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {kindLabel} · {database.plan}
          </p>
        </div>
        <Badge variant={STATUS_VARIANTS[database.status] ?? "outline"}>
          {database.status}
        </Badge>
      </div>

      <div className="mt-4 grid gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <RiDatabase2Line className="size-4" />
          <span className="truncate font-mono">{endpoint}</span>
        </div>
        <div className="flex items-center gap-2">
          <RiPlugLine className="size-4" />
          <span className="truncate">
            {linked > 0
              ? `${linked} linked app${linked > 1 ? "s" : ""}`
              : "No linked app"}
          </span>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
        <span className="text-xs text-muted-foreground">Open database</span>
        <RiArrowRightUpLine className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </div>
    </Link>
  )
}
