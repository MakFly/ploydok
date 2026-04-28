// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import {
  RiDeleteBin2Line,
  RiEyeLine,
  RiEyeOffLine,
  RiFileCopyLine,
  RiPlayLine,
  RiStopLine,
} from "@remixicon/react"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import {
  ShellPage,
  ShellPanel,
} from "../../../../../components/layout/AppShell"
import { ServiceStatusBadge } from "../../../../../components/services/ServiceStatusBadge"
import {
  useDeleteService,
  useService,
  useServiceLogs,
  useStartService,
  useStopService,
} from "../../../../../lib/services"
import { useCurrentOrganization } from "../../../../../lib/organizations"

export const Route = createFileRoute("/_authed/orgs/$orgSlug/services/$id")({
  component: ServiceDetailPage,
})

function ServiceDetailPage(): React.JSX.Element {
  const { id } = Route.useParams()
  const organization = useCurrentOrganization()
  const { data: service, isLoading, error } = useService(id)
  const [deleteOpen, setDeleteOpen] = React.useState(false)

  if (isLoading) {
    return (
      <ShellPage title="Service" eyebrow={organization?.name ?? "Workspace"}>
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 rounded bg-muted" />
          <div className="h-40 rounded-lg bg-muted" />
        </div>
      </ShellPage>
    )
  }

  if (error || !service) {
    return (
      <ShellPage title="Service" eyebrow={organization?.name ?? "Workspace"}>
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          Impossible de charger le service.
        </p>
      </ShellPage>
    )
  }

  const isRunning = service.status === "running"
  const isStopped = service.status === "stopped" || service.status === "failed"

  return (
    <ShellPage
      title={service.name}
      eyebrow={organization?.name ?? "Workspace"}
      actions={
        <div className="flex items-center gap-2">
          {isStopped ? <StartButton id={id} /> : null}
          {isRunning ? <StopButton id={id} /> : null}
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <RiDeleteBin2Line className="size-4" />
            Delete
          </Button>
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          <ServiceHeaderPanel service={service} />
          <LogsPanel id={id} />
          <ComposePanel compose={service.compose_raw} />
        </div>
        <GeneratedEnvPanel env={service.generated_env} />
      </div>

      <DeleteDialog
        open={deleteOpen}
        serviceName={service.name}
        serviceId={id}
        onClose={() => setDeleteOpen(false)}
      />
    </ShellPage>
  )
}

function StartButton({ id }: { id: string }): React.JSX.Element {
  const start = useStartService()
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => start.mutate(id)}
      disabled={start.isPending}
    >
      <RiPlayLine className="size-4" />
      Start
    </Button>
  )
}

function StopButton({ id }: { id: string }): React.JSX.Element {
  const stop = useStopService()
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => stop.mutate(id)}
      disabled={stop.isPending}
    >
      <RiStopLine className="size-4" />
      Stop
    </Button>
  )
}

function ServiceHeaderPanel({
  service,
}: {
  service: {
    name: string
    status: string | null
    domain: string | null
    template_id: string
    template_version: string | null
  }
}): React.JSX.Element {
  return (
    <ShellPanel title="Détails">
      <div className="grid gap-3 text-sm">
        <Row label="Statut">
          <ServiceStatusBadge status={service.status as never} />
        </Row>
        <Row label="Template">
          <span className="font-mono text-xs">
            {service.template_id}
            {service.template_version ? ` v${service.template_version}` : ""}
          </span>
        </Row>
        {service.domain ? (
          <Row label="Domain">
            <a
              href={`https://${service.domain}`}
              target="_blank"
              rel="noreferrer noopener"
              className="font-mono text-xs text-primary underline underline-offset-2"
            >
              {service.domain}
            </a>
          </Row>
        ) : null}
      </div>
    </ShellPanel>
  )
}

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-card px-4 py-3">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span>{children}</span>
    </div>
  )
}

function LogsPanel({ id }: { id: string }): React.JSX.Element {
  const { data, isLoading } = useServiceLogs(id)
  const lines = data?.lines ?? []

  return (
    <ShellPanel
      title="Logs"
      description="Dernières 200 lignes — rafraîchissement automatique toutes les 5 s."
    >
      {isLoading ? (
        <div className="h-40 animate-pulse rounded-md bg-muted" />
      ) : lines.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Aucune ligne de log disponible.
        </p>
      ) : (
        <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-[11px] leading-relaxed text-muted-foreground">
          {lines.map((l, i) => (
            <span key={i} className="block">
              {l.line}
            </span>
          ))}
        </pre>
      )}
    </ShellPanel>
  )
}

function ComposePanel({ compose }: { compose: string }): React.JSX.Element {
  return (
    <ShellPanel
      title="Compose"
      description="Contenu docker-compose.yml utilisé pour ce service."
    >
      <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-[11px] leading-relaxed text-muted-foreground">
        <code>{compose}</code>
      </pre>
    </ShellPanel>
  )
}

function GeneratedEnvPanel({
  env,
}: {
  env: Record<string, string>
}): React.JSX.Element {
  const entries = Object.entries(env)
  const [revealed, setRevealed] = React.useState<Set<string>>(new Set())
  const [copied, setCopied] = React.useState<string | null>(null)

  const toggleReveal = (key: string): void => {
    setRevealed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleCopy = async (key: string, value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(key)
      window.setTimeout(() => setCopied(null), 1500)
    } catch {
      // ignore clipboard failure
    }
  }

  return (
    <ShellPanel
      title="Variables générées"
      description="Variables d'environnement auto-générées à l'installation (lecture seule)."
    >
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Aucune variable générée.
        </p>
      ) : (
        <div className="space-y-2">
          {entries.map(([key, value]) => {
            const isRevealed = revealed.has(key)
            return (
              <div
                key={key}
                className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[11px] font-medium text-foreground">
                    {key}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                    {isRevealed ? value : "••••••••"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => toggleReveal(key)}
                  aria-label={isRevealed ? "Masquer" : "Révéler"}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  {isRevealed ? (
                    <RiEyeOffLine className="size-4" />
                  ) : (
                    <RiEyeLine className="size-4" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopy(key, value)}
                  aria-label="Copier"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <RiFileCopyLine className="size-4" />
                </button>
                {copied === key ? (
                  <span className="text-[10px] text-green-600">Copié</span>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </ShellPanel>
  )
}

function DeleteDialog({
  open,
  serviceName,
  serviceId,
  onClose,
}: {
  open: boolean
  serviceName: string
  serviceId: string
  onClose: () => void
}): React.JSX.Element {
  const router = useRouter()
  const { orgSlug } = Route.useParams()
  const deleteService = useDeleteService()
  const [confirm, setConfirm] = React.useState("")
  const expected = `delete ${serviceName}`

  const handleDelete = async (): Promise<void> => {
    await deleteService.mutateAsync({ id: serviceId, name: serviceName })
    onClose()
    await router.navigate({
      to: "/orgs/$orgSlug/services",
      params: { orgSlug },
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Supprimer {serviceName}</DialogTitle>
          <DialogDescription>
            Cette action est irréversible. Tous les containers et données
            associés seront supprimés. Tape{" "}
            <strong className="font-mono">{expected}</strong> pour confirmer.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={expected}
          className="font-mono text-sm"
        />
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={deleteService.isPending}
          >
            Annuler
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void handleDelete()}
            disabled={confirm !== expected || deleteService.isPending}
          >
            {deleteService.isPending ? "Suppression…" : "Supprimer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
