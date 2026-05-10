// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { ShellPage } from "../../../../../components/layout/AppShell"
import {
  useDatabase,
  useDatabaseLogs,
  useStartDatabase,
  useStopDatabase,
  useUpdateDatabaseNetwork,
} from "../../../../../lib/databases"
import { RevealConnectionDialog } from "../../../../../components/databases/RevealConnectionDialog"
import { RestartDatabaseDialog } from "../../../../../components/databases/RestartDatabaseDialog"
import { RotationPanel } from "../../../../../components/databases/RotationPanel"
import { BackupConfigPanel } from "../../../../../components/databases/BackupConfigPanel"
import { BackupsList } from "../../../../../components/databases/BackupsList"
import { DeleteDatabaseDialog } from "../../../../../components/databases/DeleteDatabaseDialog"
import { DatabaseStatusBadge } from "../../../../../components/databases/DatabaseStatusBadge"
import { OpenAdminerDialog } from "../../../../../components/databases/OpenAdminerDialog"
import { ResourceCard } from "../../../../../components/monitoring/ResourceCard"
import { useBackupNow } from "../../../../../lib/backups"
import {
  useMonitoring,
  useMonitoringEvents,
} from "../../../../../lib/monitoring"
import {
  organizationPath,
  useCurrentOrganizationSlug,
} from "../../../../../lib/organizations"
import type { ContainerSnapshot } from "@ploydok/shared"

export const Route = createFileRoute("/_authed/orgs/$orgSlug/databases/$id")({
  component: DatabaseDetailPage,
})

const MONITORING_RING_SIZE = 60

function appendMonitoringRing(
  values: Array<number>,
  nextValue: number
): Array<number> {
  const next = [...values, nextValue]
  return next.length > MONITORING_RING_SIZE
    ? next.slice(next.length - MONITORING_RING_SIZE)
    : next
}

function findDatabaseSnapshot(
  containers: Array<ContainerSnapshot>,
  dbId: string
): ContainerSnapshot | null {
  return (
    containers.find(
      (container) => container.kind === "database" && container.app_id === dbId
    ) ??
    containers.find((container) => container.app_id === dbId) ??
    null
  )
}

function DatabaseMonitoringPanel({
  dbId,
}: {
  dbId: string
}): React.JSX.Element {
  const { data, isLoading, error, isFetching, refetch } = useMonitoring()
  const [snapshot, setSnapshot] = React.useState<ContainerSnapshot | null>(null)
  const [cpuHistory, setCpuHistory] = React.useState<Array<number>>([])
  const [memHistory, setMemHistory] = React.useState<Array<number>>([])

  const overviewSnapshot = React.useMemo(
    () => findDatabaseSnapshot(data?.containers ?? [], dbId),
    [data?.containers, dbId]
  )

  useMonitoringEvents(
    React.useCallback(
      (nextSnapshot) => {
        if (nextSnapshot.kind !== "database" || nextSnapshot.app_id !== dbId) {
          return
        }
        setSnapshot(nextSnapshot)
        setCpuHistory((current) =>
          appendMonitoringRing(current, nextSnapshot.cpu_pct)
        )
        setMemHistory((current) =>
          appendMonitoringRing(current, nextSnapshot.mem_bytes)
        )
      },
      [dbId]
    )
  )

  React.useEffect(() => {
    setSnapshot(null)
    setCpuHistory([])
    setMemHistory([])
  }, [dbId])

  React.useEffect(() => {
    if (!overviewSnapshot) return
    setSnapshot((current) => {
      if (
        current?.id === overviewSnapshot.id &&
        current.last_seen_ms === overviewSnapshot.last_seen_ms
      ) {
        return current
      }
      return overviewSnapshot
    })
    setCpuHistory((current) =>
      current.at(-1) === overviewSnapshot.cpu_pct
        ? current
        : appendMonitoringRing(current, overviewSnapshot.cpu_pct)
    )
    setMemHistory((current) =>
      current.at(-1) === overviewSnapshot.mem_bytes
        ? current
        : appendMonitoringRing(current, overviewSnapshot.mem_bytes)
    )
  }, [overviewSnapshot])

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Monitoring unavailable</AlertTitle>
        <AlertDescription>
          Failed to load monitoring data: {error.message}
        </AlertDescription>
      </Alert>
    )
  }

  if (!snapshot) {
    return (
      <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
        {isLoading
          ? "Loading database monitoring..."
          : "No live container snapshot found for this database yet."}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          Live container snapshot ·{" "}
          {new Date(snapshot.last_seen_ms).toLocaleTimeString()}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          {isFetching ? "Refreshing..." : "Refresh"}
        </Button>
      </div>
      <ResourceCard
        snapshot={snapshot}
        cpuHistory={cpuHistory}
        memHistory={memHistory}
      />
    </div>
  )
}

function DatabaseDetailPage(): React.JSX.Element {
  const { id: routeDbId } = useParams({ strict: false })
  const dbId = routeDbId!
  const navigate = useNavigate()
  const currentOrgSlug = useCurrentOrganizationSlug()
  const { data: db, isLoading, error, refetch } = useDatabase(dbId)
  const { data: logs } = useDatabaseLogs(dbId)
  const [revealOpen, setRevealOpen] = React.useState(false)
  const [adminerOpen, setAdminerOpen] = React.useState(false)
  const [restartOpen, setRestartOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [publicEnabled, setPublicEnabled] = React.useState(false)
  const [exposureMode, setExposureMode] = React.useState<
    "internal" | "direct_port" | "public_proxy"
  >("internal")
  const { mutate: startDb, isPending: isStarting } = useStartDatabase()
  const { mutate: stopDb, isPending: isStopping } = useStopDatabase()
  const { mutate: backupNow, isPending: isBackingUp } = useBackupNow(dbId)
  const { mutate: updateNetwork, isPending: isUpdatingNetwork } =
    useUpdateDatabaseNetwork()

  React.useEffect(() => {
    if (db) {
      setPublicEnabled(db.public_enabled)
      setExposureMode(db.exposure_mode)
    }
  }, [db])

  if (isLoading) {
    return (
      <ShellPage title="Database">
        <div className="text-muted-foreground">Loading...</div>
      </ShellPage>
    )
  }

  if (error || !db) {
    return (
      <ShellPage title="Database">
        <div className="text-destructive">Database not found.</div>
      </ShellPage>
    )
  }

  const isExternal = db.management_mode === "external"
  const adminerSupported =
    !isExternal &&
    (db.kind === "postgres" || db.kind === "mysql" || db.kind === "mariadb")
  const canOpenAdminer = adminerSupported && db.status === "running"

  return (
    <ShellPage
      title={db.name}
      description={
        isExternal
          ? `${db.kind} · external endpoint`
          : `${db.kind} ${db.version} · ${db.plan} plan`
      }
      actions={
        <div className="flex items-center gap-2">
          <DatabaseStatusBadge status={db.status} health={db.health_status} />
          <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
            Delete
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
          <div className="rounded-lg border p-4">
            <div className="grid gap-3 text-sm sm:grid-cols-2">
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
                <div>
                  {db.last_started_at
                    ? new Date(db.last_started_at).toLocaleString()
                    : "—"}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-lg border p-4">
            {isExternal ? (
              <>
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium">
                    External PostgreSQL endpoint
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Ploydok stores and injects the connection string, but the
                    database process, firewall, backups, and password rotation
                    are managed outside Ploydok.
                  </span>
                </div>
                <div className="rounded-md border bg-muted/30 px-3 py-2 font-mono text-xs">
                  {db.internal_host ?? "—"}:{db.internal_port ?? "—"}
                </div>
                <Button variant="outline" onClick={() => setRevealOpen(true)}>
                  Reveal connection string
                </Button>
                {adminerSupported && (
                  <Button
                    variant="outline"
                    onClick={() => setAdminerOpen(true)}
                    disabled={!canOpenAdminer}
                  >
                    Open Adminer
                  </Button>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">
                      Direct public port
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Internal linking always keeps the private endpoint.
                    </span>
                  </div>
                  <Switch
                    checked={publicEnabled}
                    onCheckedChange={(next) => {
                      setPublicEnabled(next)
                      setExposureMode(
                        next
                          ? db.exposure_mode === "internal"
                            ? "direct_port"
                            : db.exposure_mode
                          : "internal"
                      )
                    }}
                    disabled={isUpdatingNetwork}
                  />
                </div>
                {publicEnabled && (
                  <Select
                    value={exposureMode}
                    onValueChange={(value) =>
                      setExposureMode(
                        value as "internal" | "direct_port" | "public_proxy"
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="direct_port">Direct port</SelectItem>
                      <SelectItem value="public_proxy">Public proxy</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                {publicEnabled && (
                  <Alert variant="destructive">
                    <AlertTitle>
                      This database will be reachable publicly
                    </AlertTitle>
                    <AlertDescription>
                      The container port will be bound to{" "}
                      <span className="font-mono">0.0.0.0</span> on the host.
                      Any client able to reach this server on the allocated port
                      can attempt to connect with the generated credentials.
                      Make sure your firewall only allows the IPs you trust
                      before applying.
                    </AlertDescription>
                  </Alert>
                )}
                <Button
                  variant={publicEnabled ? "destructive" : "outline"}
                  onClick={() =>
                    updateNetwork({
                      id: dbId,
                      exposureMode: publicEnabled ? exposureMode : "internal",
                      publicEnabled,
                    })
                  }
                  disabled={isUpdatingNetwork}
                >
                  {isUpdatingNetwork
                    ? "Updating network..."
                    : publicEnabled
                      ? "Expose database publicly"
                      : "Apply network settings"}
                </Button>
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    variant="outline"
                    onClick={() => startDb(dbId)}
                    disabled={isStarting || db.status === "running"}
                  >
                    {isStarting ? "Starting..." : "Start"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => stopDb(dbId)}
                    disabled={isStopping || db.status === "stopped"}
                  >
                    {isStopping ? "Stopping..." : "Stop"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setRestartOpen(true)}
                  >
                    Restart
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>

        <Tabs defaultValue="general" className="flex flex-col gap-4">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="connection">Connection</TabsTrigger>
            <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
            <TabsTrigger value="backups">Backups</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
            <TabsTrigger value="advanced">Advanced</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="flex flex-col gap-4">
            {db.linked_apps && db.linked_apps.length > 0 && (
              <div className="flex flex-col gap-2 rounded-lg border p-4">
                <h2 className="text-sm font-semibold">Linked apps</h2>
                {db.linked_apps.map((link) => {
                  const appHref = currentOrgSlug
                    ? organizationPath(currentOrgSlug, `apps/${link.app_id}`)
                    : `/apps/${link.app_id}`
                  return (
                    <div
                      key={link.app_id + link.env_prefix}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Badge variant="secondary">{link.env_prefix}</Badge>
                      {link.app_name ? (
                        <a
                          href={appHref}
                          className="font-medium text-foreground hover:underline"
                        >
                          {link.app_name}
                        </a>
                      ) : (
                        <span className="font-medium text-foreground">
                          (unknown app)
                        </span>
                      )}
                      <span className="font-mono text-xs text-muted-foreground">
                        {link.app_id}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}

            {isExternal ? (
              <Alert>
                <AlertTitle>External database</AlertTitle>
                <AlertDescription>
                  Lifecycle and password rotation stay with the PostgreSQL
                  server owner. Use the connection tab to reveal the stored URL
                  or link this database to apps.
                </AlertDescription>
              </Alert>
            ) : (
              <RotationPanel db={db} onScheduleChange={() => void refetch()} />
            )}
          </TabsContent>

          <TabsContent value="connection" className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 rounded-lg border p-4">
              <div>
                <span className="text-sm text-muted-foreground">
                  Internal endpoint
                </span>
                <div className="font-mono text-sm">
                  {db.connections?.internal.host ?? db.internal_host}:
                  {db.connections?.internal.port ?? db.internal_port}
                </div>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">
                  Public endpoint
                </span>
                <div className="font-mono text-sm">
                  {db.connections?.public?.url ?? db.public_url ?? "Disabled"}
                </div>
              </div>
              <Button variant="outline" onClick={() => setRevealOpen(true)}>
                Reveal connection string
              </Button>
              {adminerSupported ? (
                <Button
                  variant="outline"
                  onClick={() => setAdminerOpen(true)}
                  disabled={!canOpenAdminer}
                >
                  Open Adminer
                </Button>
              ) : (
                <div className="text-xs text-muted-foreground">
                  Adminer is available for managed PostgreSQL, MySQL, and
                  MariaDB databases.
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="monitoring" className="flex flex-col gap-4">
            {isExternal ? (
              <Alert>
                <AlertTitle>Monitoring unavailable</AlertTitle>
                <AlertDescription>
                  Ploydok only collects container metrics for managed database
                  containers. Monitor this PostgreSQL server from its host or
                  provider.
                </AlertDescription>
              </Alert>
            ) : (
              <DatabaseMonitoringPanel dbId={dbId} />
            )}
          </TabsContent>

          <TabsContent value="backups" className="flex flex-col gap-4">
            {isExternal ? (
              <Alert>
                <AlertTitle>Backups are external</AlertTitle>
                <AlertDescription>
                  Ploydok does not run backup or restore jobs against external
                  PostgreSQL endpoints yet. Keep the server or provider backup
                  policy enabled before linking production apps.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
                <div className="rounded-lg border p-4">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold">
                        Database backups
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        Manual and scheduled backups for this database.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => backupNow()}
                      disabled={isBackingUp}
                    >
                      {isBackingUp ? "Starting..." : "Backup now"}
                    </Button>
                  </div>
                  <BackupsList
                    target={{ kind: "database", databaseId: dbId }}
                    restoreLabel={db.name}
                    onBackupNow={() => backupNow()}
                    backupNowLoading={isBackingUp}
                  />
                </div>

                <div className="rounded-lg border p-4">
                  <div className="mb-4">
                    <h2 className="text-sm font-semibold">Backup policy</h2>
                    <p className="text-xs text-muted-foreground">
                      Store locally or on S3-compatible storage such as R2, AWS,
                      Scaleway, or OVH.
                    </p>
                  </div>
                  <BackupConfigPanel
                    target={{ kind: "database", databaseId: dbId }}
                  />
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="logs">
            <div className="max-h-[420px] overflow-auto rounded-lg border bg-muted/20 p-4 font-mono text-xs whitespace-pre-wrap">
              {isExternal
                ? "External databases do not have Ploydok container logs."
                : logs?.lines?.length
                  ? logs.lines
                      .map((line) => `[${line.stream ?? "log"}] ${line.line}`)
                      .join("\n")
                  : "No logs available."}
            </div>
          </TabsContent>

          <TabsContent value="advanced">
            <div className="flex flex-col gap-3 rounded-lg border p-4 text-sm">
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
                <div className="font-mono">
                  {isExternal ? "External (no Ploydok container)" : db.id}
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <RevealConnectionDialog
        databaseId={revealOpen ? dbId : null}
        onClose={() => setRevealOpen(false)}
      />
      <OpenAdminerDialog
        database={adminerOpen ? db : null}
        onClose={() => setAdminerOpen(false)}
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
            to: currentOrgSlug
              ? organizationPath(currentOrgSlug, "databases")
              : "/databases",
          })
        }}
      />
    </ShellPage>
  )
}
