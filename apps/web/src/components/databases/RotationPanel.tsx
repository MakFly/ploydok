// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { apiFetch } from "../../lib/api"
import { toast } from "sonner"
import type { Database } from "../../lib/databases"
import { RotateNowDialog } from "./RotateNowDialog"

interface RotationPanelProps {
  db: Database
  onScheduleChange: (schedule: Database["rotation_schedule"]) => void
}

function formatRotatedAt(isoStr: string | null): string {
  if (!isoStr) return "Never"
  const ms = Date.now() - new Date(isoStr).getTime()
  const days = Math.floor(ms / (1000 * 60 * 60 * 24))
  if (days === 0) return "Today"
  if (days === 1) return "Yesterday"
  return `${days} days ago`
}

export function RotationPanel({ db, onScheduleChange }: RotationPanelProps): React.JSX.Element {
  const [rotateOpen, setRotateOpen] = React.useState(false)
  const [scheduleLoading, setScheduleLoading] = React.useState(false)

  async function handleScheduleChange(value: string) {
    setScheduleLoading(true)
    try {
      await apiFetch(`/databases/${db.id}`, {
        method: "PATCH",
        body: { rotation_schedule: value },
        headers: { "content-type": "application/json" },
      })
      onScheduleChange(value as Database["rotation_schedule"])
      toast.success("Rotation schedule updated")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed")
    } finally {
      setScheduleLoading(false)
    }
  }

  return (
    <div className="border rounded-lg p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm">Password Rotation</h2>
        {db.rotation_in_progress && (
          <Badge variant="secondary" className="text-amber-600 bg-amber-500/10">
            Rotation in progress…
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <span className="text-muted-foreground block text-xs mb-1">Last rotated</span>
          <div className="font-medium">{formatRotatedAt(db.password_rotated_at)}</div>
        </div>
        <div>
          <span className="text-muted-foreground block text-xs mb-1">Schedule</span>
          <Select
            value={db.rotation_schedule}
            onValueChange={handleScheduleChange}
            disabled={scheduleLoading || db.rotation_in_progress}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Manual only</SelectItem>
              <SelectItem value="30d">Every 30 days</SelectItem>
              <SelectItem value="60d">Every 60 days</SelectItem>
              <SelectItem value="90d">Every 90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-fit"
        disabled={db.rotation_in_progress || db.status !== "running"}
        onClick={() => setRotateOpen(true)}
      >
        Rotate password now
      </Button>

      <RotateNowDialog
        databaseId={rotateOpen ? db.id : null}
        onClose={() => setRotateOpen(false)}
      />
    </div>
  )
}
