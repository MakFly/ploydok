// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { toast } from "sonner"
import { RiAddLine, RiBellLine, RiDeleteBinLine, RiEditLine, RiFlashlightLine } from "@remixicon/react"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import { Switch } from "@workspace/ui/components/switch"
import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  EVENT_LABELS,
  FUNCTIONAL_KINDS,
  KIND_LABELS,
  useChannels,
  useDeleteChannel,
  useTestChannel,
  useToggleChannel,
} from "../../lib/notification-channels"
import { ChannelDialog } from "./ChannelDialog"
import type { NotificationChannel } from "../../lib/notification-channels"

interface ChannelListProps {
  appId?: string
}

function KindBadge({ kind }: { kind: NotificationChannel["kind"] }) {
  if (FUNCTIONAL_KINDS.has(kind)) {
    return (
      <Badge
        variant="outline"
        className="text-green-700 border-green-600/40 dark:text-green-400"
      >
        {KIND_LABELS[kind]}
      </Badge>
    )
  }
  return (
    <Badge variant="secondary">
      {KIND_LABELS[kind]} · Coming soon
    </Badge>
  )
}

interface ChannelRowProps {
  channel: NotificationChannel
  appId?: string
  onEdit: (channel: NotificationChannel) => void
}

function ChannelRow({ channel, appId, onEdit }: ChannelRowProps) {
  const deleteChannel = useDeleteChannel(appId)
  const testChannel = useTestChannel()
  const toggleChannel = useToggleChannel(appId)

  async function handleDelete() {
    if (!confirm(`Supprimer "${channel.name}" ?`)) return
    try {
      await deleteChannel.mutateAsync(channel.id)
      toast.success("Channel supprimé")
    } catch {
      toast.error("Impossible de supprimer le channel")
    }
  }

  async function handleTest() {
    try {
      const result = await testChannel.mutateAsync(channel.id)
      if (result.success) {
        toast.success("Message de test envoyé")
      } else {
        toast.error(result.message ?? "Échec du test")
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Échec du test"
      toast.error(message)
    }
  }

  async function handleToggle(enabled: boolean) {
    try {
      await toggleChannel.mutateAsync({ id: channel.id, enabled })
    } catch {
      toast.error("Impossible de mettre à jour le channel")
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-background/80 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-1.5 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-sm truncate">{channel.name}</span>
          <KindBadge kind={channel.kind} />
        </div>
        <p className="text-xs text-muted-foreground">
          {channel.events.length === 0
            ? "Aucun événement"
            : channel.events.map((e) => EVENT_LABELS[e]).join(", ")}
        </p>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {channel.enabled && FUNCTIONAL_KINDS.has(channel.kind) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void handleTest()}
            disabled={testChannel.isPending}
            title="Envoyer un message de test"
          >
            <RiFlashlightLine className="size-4" />
            <span className="sr-only sm:not-sr-only">Test</span>
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onEdit(channel)}
          title="Modifier"
        >
          <RiEditLine className="size-4" />
          <span className="sr-only">Modifier</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void handleDelete()}
          disabled={deleteChannel.isPending}
          className="text-destructive hover:text-destructive"
          title="Supprimer"
        >
          <RiDeleteBinLine className="size-4" />
          <span className="sr-only">Supprimer</span>
        </Button>
        <Switch
          checked={channel.enabled}
          onCheckedChange={(v) => void handleToggle(v)}
          disabled={toggleChannel.isPending}
          size="sm"
          title={channel.enabled ? "Désactiver" : "Activer"}
        />
      </div>
    </div>
  )
}

export function ChannelList({ appId }: ChannelListProps): React.JSX.Element {
  const { data: channels, isLoading } = useChannels(appId)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editingChannel, setEditingChannel] =
    React.useState<NotificationChannel | undefined>(undefined)

  function openCreate() {
    setEditingChannel(undefined)
    setDialogOpen(true)
  }

  function openEdit(channel: NotificationChannel) {
    setEditingChannel(channel)
    setDialogOpen(true)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-lg font-semibold">Channels de notification</h2>
          <p className="text-sm text-muted-foreground">
            Recevez des alertes sur vos outils préférés quand un événement se produit.
          </p>
        </div>
        <Button type="button" size="sm" onClick={openCreate}>
          <RiAddLine className="size-4" />
          Ajouter
        </Button>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : channels && channels.length > 0 ? (
        <div className="flex flex-col gap-3">
          {channels.map((channel) => (
            <ChannelRow
              key={channel.id}
              channel={channel}
              appId={appId}
              onEdit={openEdit}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/60 bg-muted/20 py-12 px-6 text-center">
          <RiBellLine className="size-8 text-muted-foreground/50 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">
            Aucun channel configuré
          </p>
          <p className="text-xs text-muted-foreground/70 mt-1 mb-4">
            Ajoutez un channel pour recevoir des notifications sur vos builds et déploiements.
          </p>
          <Button type="button" size="sm" variant="outline" onClick={openCreate}>
            <RiAddLine className="size-4" />
            Ajouter un channel
          </Button>
        </div>
      )}

      <ChannelDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        channel={editingChannel}
        appId={appId}
      />
    </div>
  )
}
