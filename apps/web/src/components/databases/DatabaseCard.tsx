// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import type { Database } from "../../lib/databases"

const KIND_LABELS: Record<string, string> = {
  postgres: "PostgreSQL 16",
  redis: "Redis 7",
  mongo: "MongoDB 7",
}

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  running: "default",
  creating: "secondary",
  stopped: "outline",
  failed: "destructive",
}

interface DatabaseCardProps {
  database: Database
  onReveal?: (id: string) => void
  onDelete?: (db: Database) => void
  onLink?: (db: Database) => void
}

export function DatabaseCard({ database, onReveal, onDelete, onLink }: DatabaseCardProps): React.JSX.Element {
  return (
    <div className="border rounded-lg p-4 flex flex-col gap-3 bg-card">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">{database.name}</span>
            <Badge variant={STATUS_VARIANTS[database.status] ?? "outline"}>
              {database.status}
            </Badge>
          </div>
          <span className="text-xs text-muted-foreground">
            {KIND_LABELS[database.kind] ?? database.kind} · {database.plan}
          </span>
        </div>
        <div className="flex gap-2">
          {onLink && (
            <Button size="sm" variant="outline" onClick={() => onLink(database)}>
              Link
            </Button>
          )}
          {onReveal && (
            <Button size="sm" variant="outline" onClick={() => onReveal(database.id)}>
              Reveal
            </Button>
          )}
          {onDelete && (
            <Button size="sm" variant="destructive" onClick={() => onDelete(database)}>
              Delete
            </Button>
          )}
        </div>
      </div>
      {database.host && (
        <div className="text-xs text-muted-foreground font-mono">
          {database.host}:{database.port}
        </div>
      )}
      {database.linked_apps && database.linked_apps.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {database.linked_apps.map((link) => (
            <Badge key={link.app_id + link.env_prefix} variant="secondary" className="text-xs">
              {link.env_prefix}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
