// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Switch } from "@workspace/ui/components/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { useCreateDatabase } from "../../lib/databases"
import type { DbExposureMode, DbKind, DbPlan } from "../../lib/databases"

interface CreateDatabaseDialogProps {
  open: boolean
  organizationId: string
  onClose: () => void
}

const KINDS: Array<{ value: DbKind; label: string; icon: string }> = [
  { value: "postgres", label: "PostgreSQL 16", icon: "🐘" },
  { value: "mysql", label: "MySQL 8.4", icon: "🐬" },
  { value: "mariadb", label: "MariaDB 11.4", icon: "🦭" },
  { value: "redis", label: "Redis 7", icon: "⚡" },
  { value: "mongo", label: "MongoDB 7", icon: "🍃" },
]

const PLANS: Array<{ value: DbPlan; label: string; desc: string }> = [
  { value: "small", label: "Small", desc: "0.5 CPU · 512 MB" },
  { value: "medium", label: "Medium", desc: "1 CPU · 2 GB" },
  { value: "large", label: "Large", desc: "2 CPU · 8 GB" },
]

const CREATE_PROGRESS_STAGES = [
  { label: "Reserve database identity", untilMs: 1_000 },
  { label: "Provision runtime container", untilMs: 4_000 },
  { label: "Boot engine and network", untilMs: 8_000 },
  { label: "Run health probes", untilMs: 13_000 },
] as const

const CREATE_PROGRESS_TICK_MS = 120
const CREATE_SUCCESS_CLOSE_DELAY_MS = 700
const MAX_PENDING_PROGRESS = 94

function getCreateProgress(elapsedMs: number): number {
  if (elapsedMs <= 0) return 7
  const totalMs = CREATE_PROGRESS_STAGES[CREATE_PROGRESS_STAGES.length - 1]?.untilMs ?? 1
  const ratio = Math.min(elapsedMs / totalMs, 1)
  return Math.min(MAX_PENDING_PROGRESS, Math.round(7 + ratio * (MAX_PENDING_PROGRESS - 7)))
}

function getCreateStageLabel(elapsedMs: number): string {
  return (
    CREATE_PROGRESS_STAGES.find((stage) => elapsedMs <= stage.untilMs)?.label ??
    CREATE_PROGRESS_STAGES[CREATE_PROGRESS_STAGES.length - 1]?.label ??
    "Creating database"
  )
}

export function CreateDatabaseDialog({ open, organizationId, onClose }: CreateDatabaseDialogProps): React.JSX.Element {
  const [kind, setKind] = React.useState<DbKind>("postgres")
  const [plan, setPlan] = React.useState<DbPlan>("small")
  const [publicEnabled, setPublicEnabled] = React.useState(false)
  const [exposureMode, setExposureMode] = React.useState<DbExposureMode>("internal")
  const [name, setName] = React.useState("")
  const [phase, setPhase] = React.useState<"form" | "progress" | "done">("form")
  const [elapsedMs, setElapsedMs] = React.useState(0)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const createDatabase = useCreateDatabase()
  const progressTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null)
  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const isPending = createDatabase.isPending
  const progressValue = phase === "done" ? 100 : getCreateProgress(elapsedMs)
  const stageLabel = phase === "done" ? "Database ready" : getCreateStageLabel(elapsedMs)

  const clearTimers = React.useCallback(() => {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current)
      progressTimerRef.current = null
    }
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const resetForm = React.useCallback(() => {
    setKind("postgres")
    setPlan("small")
    setPublicEnabled(false)
    setExposureMode("internal")
    setName("")
  }, [])

  const resetState = React.useCallback(() => {
    clearTimers()
    setPhase("form")
    setElapsedMs(0)
    setActionError(null)
    createDatabase.reset()
  }, [clearTimers, createDatabase])

  React.useEffect(() => {
    if (!open) {
      resetState()
    }
  }, [open, resetState])

  React.useEffect(() => {
    return () => {
      clearTimers()
    }
  }, [clearTimers])

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isPending) return
    if (!nextOpen) resetState()
    onClose()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const finalExposureMode = publicEnabled ? exposureMode : "internal"

    setActionError(null)
    setPhase("progress")
    setElapsedMs(0)
    clearTimers()

    progressTimerRef.current = setInterval(() => {
      setElapsedMs((current) => current + CREATE_PROGRESS_TICK_MS)
    }, CREATE_PROGRESS_TICK_MS)

    try {
      await createDatabase.mutateAsync({
        organizationId,
        projectId: organizationId,
        kind,
        name,
        plan,
        exposureMode: finalExposureMode,
        publicEnabled,
      })

      clearTimers()
      resetForm()
      setPhase("done")
      setElapsedMs(CREATE_PROGRESS_STAGES[CREATE_PROGRESS_STAGES.length - 1]?.untilMs ?? 0)

      closeTimerRef.current = setTimeout(() => {
        resetState()
        onClose()
      }, CREATE_SUCCESS_CLOSE_DELAY_MS)
    } catch (err) {
      clearTimers()
      setPhase("form")
      setActionError(err instanceof Error ? err.message : "Database creation failed")
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {phase === "progress" || phase === "done"
              ? `Creating ${name || "database"}`
              : "Create database"}
          </DialogTitle>
          <DialogDescription>
            {phase === "progress" || phase === "done"
              ? "Waiting for the API to provision the database and confirm it is healthy."
              : "Provision a managed database inside the current organization."}
          </DialogDescription>
        </DialogHeader>

        {phase === "progress" || phase === "done" ? (
          <>
            <div className="flex flex-col gap-4">
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <span className="text-muted-foreground">{kind} {plan}</span>
                <span className="mx-2 text-muted-foreground">·</span>
                <span>{name || "database"}</span>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between text-sm">
                  <span>{stageLabel}</span>
                  <span className="font-mono tabular-nums">{progressValue}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                    style={{ width: `${progressValue}%` }}
                  />
                </div>
                <div className="grid gap-2 text-xs text-muted-foreground">
                  {CREATE_PROGRESS_STAGES.map((stage, index) => {
                    const previousUntilMs = index === 0 ? 0 : CREATE_PROGRESS_STAGES[index - 1]?.untilMs ?? 0
                    const isComplete = phase === "done" || elapsedMs > stage.untilMs
                    const isCurrent = !isComplete && elapsedMs >= previousUntilMs
                    return (
                      <div key={stage.label} className="flex items-center gap-2">
                        <span
                          className={[
                            "inline-flex size-2 rounded-full",
                            isComplete
                              ? "bg-primary"
                              : isCurrent
                                ? "bg-primary/70"
                                : "bg-muted-foreground/30",
                          ].join(" ")}
                        />
                        <span>{stage.label}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>
                {phase === "done" ? "Closing..." : "Cancel"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label>Type</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {KINDS.map((k) => (
                  <button
                    key={k.value}
                    type="button"
                    onClick={() => setKind(k.value)}
                    className={`flex flex-col items-center gap-1 rounded-md border p-3 text-sm transition-colors ${
                      kind === k.value
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-muted-foreground"
                    }`}
                  >
                    <span className="text-2xl">{k.icon}</span>
                    <span>{k.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="db-name">Name</Label>
              <Input
                id="db-name"
                placeholder="my-database"
                value={name}
                onChange={(e) => setName(e.target.value)}
                pattern="[a-z0-9-]+"
                required
              />
              <span className="text-xs text-muted-foreground">Lowercase letters, numbers, and dashes only.</span>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="db-plan">Plan</Label>
              <Select value={plan} onValueChange={(v) => setPlan(v as DbPlan)}>
                <SelectTrigger id="db-plan">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLANS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      <span className="font-medium">{p.label}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{p.desc}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="db-public">Public access</Label>
                  <span className="text-xs text-muted-foreground">
                    Exposes the database on a direct TCP port for external tools.
                  </span>
                </div>
                <Switch
                  id="db-public"
                  checked={publicEnabled}
                  onCheckedChange={(next) => {
                    setPublicEnabled(next)
                    setExposureMode(next ? "direct_port" : "internal")
                  }}
                />
              </div>
              {publicEnabled ? (
                <div className="mt-3 flex flex-col gap-2">
                  <Label htmlFor="db-exposure-mode">Exposure mode</Label>
                  <Select value={exposureMode} onValueChange={(v) => setExposureMode(v as DbExposureMode)}>
                    <SelectTrigger id="db-exposure-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="direct_port">Direct port</SelectItem>
                      <SelectItem value="public_proxy">Public proxy</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>

            {actionError ? (
              <p className="text-sm text-destructive" role="alert">
                {actionError}
              </p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={!name || isPending}>
                Create
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
