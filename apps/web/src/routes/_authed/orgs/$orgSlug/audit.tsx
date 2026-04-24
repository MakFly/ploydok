// SPDX-License-Identifier: AGPL-3.0-only
import { Suspense, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useParams } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { useAuditEvents } from "../../../../lib/audit"
import type { AuditEvent } from "@ploydok/shared"

export const Route = createFileRoute("/_authed/orgs/$orgSlug/audit")({
  component: AuditPage,
})

function AuditPage() {
  const { orgSlug } = useParams({ from: Route.id })
  const [actionPrefix, setActionPrefix] = useState<string>("")
  const [targetType, setTargetType] = useState<string>("")
  const [cursor, setCursor] = useState<number | undefined>()

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-bold">Audit</h1>
        <p className="text-sm text-gray-500">Historique des événements</p>
      </div>

      <div className="flex gap-4">
        <Select value={actionPrefix} onValueChange={setActionPrefix}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filtrer par action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Toutes les actions</SelectItem>
            <SelectItem value="app.">Applications</SelectItem>
            <SelectItem value="secret.">Secrets</SelectItem>
            <SelectItem value="webhook.">Webhooks</SelectItem>
          </SelectContent>
        </Select>

        <Select value={targetType} onValueChange={setTargetType}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filtrer par type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Tous les types</SelectItem>
            <SelectItem value="app">Application</SelectItem>
            <SelectItem value="secret">Secret</SelectItem>
            <SelectItem value="webhook">Webhook</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          onClick={() => {
            setActionPrefix("")
            setTargetType("")
            setCursor(undefined)
          }}
        >
          Réinitialiser
        </Button>
      </div>

      <Suspense fallback={<div>Chargement...</div>}>
        <AuditTimeline
          orgId={orgSlug}
          actionPrefix={actionPrefix}
          targetType={targetType}
          cursor={cursor}
          onLoadMore={(nextCursor) => setCursor(nextCursor)}
        />
      </Suspense>
    </div>
  )
}

interface AuditTimelineProps {
  orgId: string
  actionPrefix: string
  targetType: string
  cursor: number | undefined
  onLoadMore: (cursor: number | undefined) => void
}

function AuditTimeline({
  orgId,
  actionPrefix,
  targetType,
  cursor,
  onLoadMore,
}: AuditTimelineProps) {
  const { data } = useAuditEvents(orgId, {
    cursor,
    actionPrefix: actionPrefix || undefined,
    targetType: targetType || undefined,
  })

  if (data.events.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 p-8 text-center text-gray-500">
        Aucun événement enregistré
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {data.events.map((event: AuditEvent) => (
          <AuditEventRow key={event.id} event={event} />
        ))}
      </div>

      {data.nextCursor !== null && (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => onLoadMore(data.nextCursor ?? undefined)}
        >
          Charger plus
        </Button>
      )}
    </div>
  )
}

function AuditEventRow({ event }: { event: AuditEvent }): React.JSX.Element {
  const relativeTime = getRelativeTime(event.created_at)

  const actionColor = getActionColor(event.action)

  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-200 p-4">
      <div className="flex items-center gap-4">
        <span
          className={`rounded-full px-3 py-1 text-sm font-medium ${actionColor}`}
        >
          {event.action}
        </span>
        <div className="text-sm">
          <p className="font-medium">
            {event.target_type} {event.target_id}
          </p>
          {event.user_id && (
            <p className="text-xs text-gray-500">par {event.user_id}</p>
          )}
        </div>
      </div>
      <span className="text-xs text-gray-500">{relativeTime}</span>
    </div>
  )
}

function getActionColor(action: string | undefined): string {
  if (!action) return "bg-gray-100 text-gray-800"
  if (action.includes("created")) return "bg-green-100 text-green-800"
  if (action.includes("deleted")) return "bg-red-100 text-red-800"
  if (action.includes("updated")) return "bg-blue-100 text-blue-800"
  return "bg-gray-100 text-gray-800"
}

function getRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - new Date(date).getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 1) return "à l'instant"
  if (diffMins < 60) return `il y a ${diffMins}m`
  if (diffHours < 24) return `il y a ${diffHours}h`
  if (diffDays < 7) return `il y a ${diffDays}j`
  return new Date(date).toLocaleDateString()
}
