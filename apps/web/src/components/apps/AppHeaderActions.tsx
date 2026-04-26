// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Button } from "@workspace/ui/components/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import {
  RiHistoryLine,
  RiLoader4Line,
  RiRefreshLine,
  RiRocketLine,
  RiStopCircleLine,
} from "@remixicon/react"
import { cn } from "@workspace/ui/lib/utils"
import { useBuilds } from "../../lib/apps"
import {
  useDeployApp,
  useRestartApp,
  useRollbackApp,
  useStopApp,
} from "../../lib/apps-mutations"
import type { AppDetail } from "../../lib/apps"
import type { AppStatus } from "@ploydok/shared"

function isBuildInFlight(status: AppStatus): boolean {
  return (
    status === "building" || status === "pending" || status === "restarting"
  )
}

function isStopped(status: AppStatus): boolean {
  return status === "stopped" || status === "failed" || status === "created"
}

export function AppHeaderActions({
  app,
}: {
  app: AppDetail
}): React.JSX.Element {
  const { data: builds } = useBuilds(app.id, { initialData: app.builds })

  const deploy = useDeployApp(app.id)
  const restart = useRestartApp(app.id)
  const rollback = useRollbackApp(app.id)
  const stop = useStopApp(app.id)

  const inFlight = isBuildInFlight(app.status)
  const stopped = isStopped(app.status)
  const succeededBuilds = (builds ?? []).filter((b) => b.status === "succeeded")
  const canRollback = succeededBuilds.length >= 2

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button
        size="sm"
        variant="default"
        onClick={() => deploy.mutate()}
        disabled={deploy.isPending || inFlight}
        title="Pull source from git, build, and deploy"
        className="gap-1.5"
      >
        {deploy.isPending ? (
          <RiLoader4Line className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <RiRocketLine className="size-4" aria-hidden="true" />
        )}
        {stopped ? "Deploy" : "Redeploy"}
      </Button>

      <ConfirmButton
        size="sm"
        variant="secondary"
        icon={<RiRefreshLine className="size-4" />}
        label="Restart"
        title="Restart the container without rebuilding (uses the last successful image)"
        disabled={restart.isPending || stopped || inFlight}
        loading={restart.isPending}
        confirmTitle="Restart application?"
        confirmDescription="The current container will be replaced by a fresh instance running the last successful image. The app will be briefly unavailable."
        confirmActionLabel="Restart"
        onConfirm={() => restart.mutate()}
      />

      <ConfirmButton
        size="sm"
        variant="secondary"
        icon={<RiHistoryLine className="size-4" />}
        label="Rollback"
        title={
          canRollback
            ? "Roll back to the previous successful build"
            : "Need at least two successful builds to roll back"
        }
        disabled={rollback.isPending || !canRollback || inFlight}
        loading={rollback.isPending}
        confirmTitle="Roll back to previous build?"
        confirmDescription="The app will be redeployed using the build immediately before the current one. The previous build remains available — you can roll forward later from the deployments tab."
        confirmActionLabel="Roll back"
        onConfirm={() => rollback.mutate()}
      />

      {!stopped && (
        <ConfirmButton
          size="sm"
          variant="destructive"
          icon={<RiStopCircleLine className="size-4" />}
          label="Stop"
          title="Stop the running container and remove its public route"
          disabled={stop.isPending || inFlight}
          loading={stop.isPending}
          confirmTitle="Stop this application?"
          confirmDescription={
            <>
              <span className="mb-2 block">
                The running container will be stopped and the public route
                removed from Caddy.
              </span>
              <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                <li>The app will become unreachable on its public domain.</li>
                <li>Non-persistent in-memory data will be lost.</li>
                <li>Volumes and registry images are preserved.</li>
              </ul>
            </>
          }
          confirmActionLabel="Stop application"
          onConfirm={() => stop.mutate()}
        />
      )}
    </div>
  )
}

interface ConfirmButtonProps {
  size?: "sm" | "default"
  variant: "secondary" | "destructive" | "default"
  icon: React.ReactNode
  label: string
  title: string
  disabled?: boolean
  loading?: boolean
  confirmTitle: string
  confirmDescription: React.ReactNode
  confirmActionLabel: string
  onConfirm: () => void
}

function ConfirmButton({
  size = "default",
  variant,
  icon,
  label,
  title,
  disabled,
  loading,
  confirmTitle,
  confirmDescription,
  confirmActionLabel,
  onConfirm,
}: ConfirmButtonProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button
        size={size}
        variant={variant}
        disabled={disabled}
        title={title}
        onClick={() => setOpen(true)}
        className="gap-1.5"
      >
        {loading ? (
          <RiLoader4Line className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          icon
        )}
        {label}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-sm text-muted-foreground">
                {confirmDescription}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setOpen(false)
                onConfirm()
              }}
              className={cn(
                variant === "destructive" &&
                  "text-destructive-foreground bg-destructive hover:bg-destructive/90"
              )}
            >
              {confirmActionLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
