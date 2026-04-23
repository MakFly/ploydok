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
import { useRestartDatabase } from "../../lib/databases"
import type { Database } from "../../lib/databases"

const RESTART_PROGRESS_STAGES = [
  { label: "Stop current runtime", untilMs: 1_400 },
  { label: "Provision fresh container", untilMs: 4_400 },
  { label: "Run health probes", untilMs: 9_500 },
  { label: "Reattach network path", untilMs: 14_000 },
] as const

const PROGRESS_TICK_MS = 120
const SUCCESS_CLOSE_DELAY_MS = 700
const MAX_PENDING_PROGRESS = 94

export function getRestartProgress(elapsedMs: number): number {
  if (elapsedMs <= 0) return 8
  const totalMs = RESTART_PROGRESS_STAGES[RESTART_PROGRESS_STAGES.length - 1]?.untilMs ?? 1
  const ratio = Math.min(elapsedMs / totalMs, 1)
  return Math.min(MAX_PENDING_PROGRESS, Math.round(8 + ratio * (MAX_PENDING_PROGRESS - 8)))
}

export function getRestartStageLabel(elapsedMs: number): string {
  return (
    RESTART_PROGRESS_STAGES.find((stage) => elapsedMs <= stage.untilMs)?.label ??
    RESTART_PROGRESS_STAGES[RESTART_PROGRESS_STAGES.length - 1]?.label ??
    "Restarting database"
  )
}

interface RestartDatabaseDialogProps {
  database: Database | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RestartDatabaseDialog({
  database,
  open,
  onOpenChange,
}: RestartDatabaseDialogProps): React.JSX.Element {
  const [phase, setPhase] = React.useState<"confirm" | "progress" | "done">("confirm")
  const [elapsedMs, setElapsedMs] = React.useState(0)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const progressTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null)
  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const restartDatabase = useRestartDatabase()
  const resetMutationRef = React.useRef(restartDatabase.reset)

  const isPending = restartDatabase.isPending
  const progressValue = phase === "done" ? 100 : getRestartProgress(elapsedMs)
  const stageLabel = phase === "done" ? "Database ready" : getRestartStageLabel(elapsedMs)

  React.useEffect(() => {
    resetMutationRef.current = restartDatabase.reset
  }, [restartDatabase.reset])

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

  const resetState = React.useCallback(() => {
    clearTimers()
    setPhase("confirm")
    setElapsedMs(0)
    setActionError(null)
    resetMutationRef.current()
  }, [clearTimers])

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
    onOpenChange(nextOpen)
  }

  const handleRestart = async () => {
    if (!database) return
    setActionError(null)
    setPhase("progress")
    setElapsedMs(0)
    clearTimers()

    progressTimerRef.current = setInterval(() => {
      setElapsedMs((current) => current + PROGRESS_TICK_MS)
    }, PROGRESS_TICK_MS)

    try {
      await restartDatabase.mutateAsync(database.id)
      clearTimers()
      setPhase("done")
      setElapsedMs(RESTART_PROGRESS_STAGES[RESTART_PROGRESS_STAGES.length - 1]?.untilMs ?? 0)
      closeTimerRef.current = setTimeout(() => {
        resetState()
        onOpenChange(false)
      }, SUCCESS_CLOSE_DELAY_MS)
    } catch (err) {
      clearTimers()
      setPhase("confirm")
      setActionError(err instanceof Error ? err.message : "Restart failed")
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {phase === "progress" || phase === "done"
              ? `Restarting ${database?.name ?? "database"}`
              : `Restart ${database?.name ?? "database"}?`}
          </DialogTitle>
          <DialogDescription>
            {phase === "progress" || phase === "done"
              ? "Waiting for the API to confirm the fresh container is healthy."
              : "This will restart the database container and wait for healthchecks to pass before marking it ready."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {database ? (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <span className="text-muted-foreground">{database.kind} {database.version}</span>
              <span className="mx-2 text-muted-foreground">·</span>
              <span>{database.plan}</span>
            </div>
          ) : null}

          {phase === "progress" || phase === "done" ? (
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
                {RESTART_PROGRESS_STAGES.map((stage, index) => {
                  const previousUntilMs = index === 0 ? 0 : RESTART_PROGRESS_STAGES[index - 1]?.untilMs ?? 0
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
          ) : (
            <p className="text-sm text-muted-foreground">
              The runtime will stop, provision a fresh container, run health probes, then restore the database endpoint.
            </p>
          )}

          {actionError ? (
            <p className="text-sm text-destructive" role="alert">
              {actionError}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isPending}
          >
            {phase === "done" ? "Closing…" : "Cancel"}
          </Button>
          {phase !== "progress" && phase !== "done" ? (
            <Button onClick={() => void handleRestart()} disabled={!database || isPending}>
              Restart database
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
