// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Switch } from "@workspace/ui/components/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { ShellPage } from "../../../../../components/layout/AppShell"
import {
  useDatabase,
  useDatabaseLogs,
  useDatabaseStats,
  useStartDatabase,
  useStopDatabase,
  useUpdateDatabaseNetwork,
} from "../../../../../lib/databases"
import { RevealConnectionDialog } from "../../../../../components/databases/RevealConnectionDialog"
import { RestartDatabaseDialog } from "../../../../../components/databases/RestartDatabaseDialog"
import { RotationPanel } from "../../../../../components/databases/RotationPanel"
import { DeleteDatabaseDialog } from "../../../../../components/databases/DeleteDatabaseDialog"
import { organizationPath, useCurrentOrganizationSlug } from "../../../../../lib/organizations"

export const Route = createFileRoute("/_authed/orgs/$orgSlug/databases/$id")({
  component: DatabaseDetailPage,
})

function DatabaseDetailPage(): React.JSX.Element {
  const { id } = useParams({ strict: false }) as { id: string }
  const navigate = useNavigate()
  const currentOrgSlug = useCurrentOrganizationSlug()
  const { data: db, isLoading, error, refetch } = useDatabase(id)
  const { data: logs } = useDatabaseLogs(id)
  const { data: stats } = useDatabaseStats(id)
  const [revealOpen, setRevealOpen] = React.useState(false)
  const [restartOpen, setRestartOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [publicEnabled, setPublicEnabled] = React.useState(false)
  const [exposureMode, setExposureMode] = React.useState<"internal" | "direct_port" | "public_proxy">("internal")
  const { mutate: startDb, isPending: isStarting } = useStartDatabase()
  const { mutate: stopDb, isPending: isStopping } = useStopDatabase()
  const { mutate: updateNetwork, isPending: isUpdatingNetwork } = useUpdateDatabaseNetwork()

  React.useEffect(() => {
    if (db) {
      setPublicEnabled(db.public_enabled)
      setExposureMode(db.exposure_mode)
    }
  }, [db])

  if (isLoading) {
    return <ShellPage title="Database"><div className="text-muted-foreground">Loading...</div></ShellPage>
  }

  if (error || !db) {
    return <ShellPage title="Database"><div className="text-destructive">Database not found.</div></ShellPage>
  }

  return (
    <ShellPage
      title={db.name}
      description={`${db.kind} ${db.version} · ${db.plan} plan`}
      actions={
        <div className="flex items-center gap-2">
          <Badge variant={db.status === "running" ? "default" : "secondary"}>
            {db.status}
          </Badge>
          <Badge variant={db.health_status === "healthy" ? "default" : "outline"}>
            {db.health_status}
          </Badge>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
          <div className="rounded-lg border p-4">
            <div className="grid gap-3 sm:grid-cols-2 text-sm">
              <div>
                <span className="text-muted-foreground">Internal host</span>
                <div className="font-mono">{db.internal_host ?? "—"}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Internal port</span>
                <div className="font-mono">{db.internal_port ?? "—"}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Exposure mode</span>
                <div>{db.exposure_mode}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Created</span>
                <div>{new Date(db.created_at).toLocaleDateString()}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Public endpoint</span>
                <div className="font-mono">{db.public_url ?? "Disabled"}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Last start</span>
                <div>{db.last_started_at ? new Date(db.last_started_at).toLocaleString() : "—"}</div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <span className="font-medium text-sm">Direct public port</span>
                <span className="text-xs text-muted-foreground">
                  Internal linking always keeps the private endpoint.
                </span>
              </div>
              <Switch
                checked={publicEnabled}
                onCheckedChange={(next) => {
                  setPublicEnabled(next)
                  setExposureMode(next ? (db.exposure_mode === "internal" ? "direct_port" : db.exposure_mode) : "internal")
                }}
                disabled={isUpdatingNetwork}
              />
            </div>
            <Button
              variant="outline"
              onClick={() => updateNetwork({ id, exposureMode: publicEnabled ? exposureMode : "internal", publicEnabled })}
              disabled={isUpdatingNetwork}
            >
              {isUpdatingNetwork ? "Updating network..." : "Apply network settings"}
            </Button>
            {publicEnabled && (
              <Select value={exposureMode} onValueChange={(value) => setExposureMode(value as "internal" | "direct_port" | "public_proxy")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="direct_port">Direct port</SelectItem>
                  <SelectItem value="public_proxy">Public proxy</SelectItem>
                </SelectContent>
              </Select>
            )}
            <div className="grid grid-cols-3 gap-2">
              <Button variant="outline" onClick={() => startDb(id)} disabled={isStarting || db.status === "running"}>
                {isStarting ? "Starting..." : "Start"}
              </Button>
              <Button variant="outline" onClick={() => stopDb(id)} disabled={isStopping || db.status === "stopped"}>
                {isStopping ? "Stopping..." : "Stop"}
              </Button>
              <Button variant="outline" onClick={() => setRestartOpen(true)}>
                Restart
              </Button>
            </div>
          </div>
        </div>

        <Tabs defaultValue="general" className="flex flex-col gap-4">
          <TabsList variant="line">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="connection">Connection</TabsTrigger>
            <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
            <TabsTrigger value="advanced">Advanced</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="flex flex-col gap-4">
            {db.linked_apps && db.linked_apps.length > 0 && (
              <div className="border rounded-lg p-4 flex flex-col gap-2">
                <h2 className="font-semibold text-sm">Linked apps</h2>
                {db.linked_apps.map((link) => (
                  <div key={link.app_id + link.env_prefix} className="flex items-center gap-2 text-sm">
                    <Badge variant="secondary">{link.env_prefix}</Badge>
                    <span className="text-muted-foreground font-mono text-xs">{link.app_id}</span>
                  </div>
                ))}
              </div>
            )}

            <RotationPanel
              db={db}
              onScheduleChange={() => void refetch()}
            />
          </TabsContent>

          <TabsContent value="connection" className="flex flex-col gap-4">
            <div className="border rounded-lg p-4 flex flex-col gap-3">
              <div>
                <span className="text-muted-foreground text-sm">Internal endpoint</span>
                <div className="font-mono text-sm">
                  {db.connections?.internal.host ?? db.internal_host}:{db.connections?.internal.port ?? db.internal_port}
                </div>
              </div>
              <div>
                <span className="text-muted-foreground text-sm">Public endpoint</span>
                <div className="font-mono text-sm">
                  {db.connections?.public?.url ?? db.public_url ?? "Disabled"}
                </div>
              </div>
              <Button variant="outline" onClick={() => setRevealOpen(true)}>
                Reveal connection string
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="monitoring" className="flex flex-col gap-4">
            <div className="border rounded-lg p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
              <div>
                <span className="text-muted-foreground">CPU</span>
                <div>{stats?.stats ? `${stats.stats.cpu_percent.toFixed(2)} %` : "—"}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Memory</span>
                <div>{stats?.stats ? `${Math.round(stats.stats.memory_bytes / 1024 / 1024)} MB` : "—"}</div>
              </div>
              <div>
                <span className="text-muted-foreground">RX</span>
                <div>{stats?.stats ? `${Math.round(stats.stats.net_rx_bytes / 1024)} KB` : "—"}</div>
              </div>
              <div>
                <span className="text-muted-foreground">TX</span>
                <div>{stats?.stats ? `${Math.round(stats.stats.net_tx_bytes / 1024)} KB` : "—"}</div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="logs">
            <div className="border rounded-lg bg-muted/20 p-4 font-mono text-xs whitespace-pre-wrap max-h-[420px] overflow-auto">
              {logs?.lines?.length
                ? logs.lines.map((line) => `[${line.stream ?? "log"}] ${line.line}`).join("\n")
                : "No logs available."}
            </div>
          </TabsContent>

          <TabsContent value="advanced">
            <div className="border rounded-lg p-4 flex flex-col gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">Version</span>
                <div>{db.version}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Rotation</span>
                <div>{db.rotation_schedule}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Container</span>
                <div className="font-mono">{db.id}</div>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex gap-3">
          <Button
            variant="destructive"
            onClick={() => setDeleteOpen(true)}
          >
            Delete
          </Button>
        </div>
      </div>

      <RevealConnectionDialog
        databaseId={revealOpen ? id : null}
        onClose={() => setRevealOpen(false)}
      />
      <RestartDatabaseDialog
        database={restartOpen ? db : null}
        open={restartOpen}
        onOpenChange={setRestartOpen}
      />
      <DeleteDatabaseDialog
        database={deleteOpen ? db : null}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={() => {
          void navigate({
            to: currentOrgSlug ? organizationPath(currentOrgSlug, "databases") : "/databases",
          })
        }}
      />
    </ShellPage>
  )
}
