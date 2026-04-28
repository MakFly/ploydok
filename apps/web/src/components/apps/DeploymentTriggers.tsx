// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { toast } from "sonner"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Switch } from "@workspace/ui/components/switch"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"
import { useApp } from "../../lib/apps"
import { useUpdateAppSettings } from "../../lib/apps-mutations"
import { patchAppSettings } from "../../lib/webhooks"
import type { AppDetail } from "../../lib/apps"
import type { AutoDeploySettings } from "../../lib/webhooks"

interface AppAutoDeployFields {
  autoDeployEnabled?: boolean
  postCommitStatus?: boolean
  coalescePushes?: boolean
  deployOnTag?: boolean
  tagPattern?: string
}

export function DeploymentTriggers({
  appId,
}: {
  appId: string
}): React.JSX.Element {
  const { data: app, isLoading, error } = useApp(appId)

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-72 rounded-lg" />
        <Skeleton className="h-72 rounded-lg" />
      </div>
    )
  }

  if (error || !app) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Failed to load triggers</AlertTitle>
        <AlertDescription>
          {error?.message ?? "The application was not found."}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <AutoDeployCard appId={appId} app={app} />
      <DeployHooksCard appId={appId} app={app} />
    </div>
  )
}

function AutoDeployCard({
  appId,
  app,
}: {
  appId: string
  app: AppDetail
}): React.JSX.Element {
  const [autoSettings, setAutoSettings] = React.useState<AutoDeploySettings>(
    () => {
      const fields = app as AppDetail & AppAutoDeployFields
      return {
        autoDeployEnabled: fields.autoDeployEnabled ?? true,
        postCommitStatus: fields.postCommitStatus ?? true,
        coalescePushes: fields.coalescePushes ?? true,
        deployOnTag: fields.deployOnTag ?? false,
        tagPattern: fields.tagPattern ?? undefined,
      }
    }
  )

  React.useEffect(() => {
    const fields = app as AppDetail & AppAutoDeployFields
    setAutoSettings({
      autoDeployEnabled: fields.autoDeployEnabled ?? true,
      postCommitStatus: fields.postCommitStatus ?? true,
      coalescePushes: fields.coalescePushes ?? true,
      deployOnTag: fields.deployOnTag ?? false,
      tagPattern: fields.tagPattern ?? undefined,
    })
  }, [app])

  const handleSwitchChange = async (
    key: keyof AutoDeploySettings,
    value: boolean | string
  ): Promise<void> => {
    const previous = { ...autoSettings }
    const next = { ...autoSettings, [key]: value }
    setAutoSettings(next)
    try {
      await patchAppSettings(appId, { [key]: value })
      toast.success("Setting updated")
    } catch (err) {
      setAutoSettings(previous)
      toast.error(err instanceof Error ? err.message : "Update failed")
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Auto-deploy</CardTitle>
        <CardDescription>
          How pushes turn into deployments. Changes save instantly.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col divide-y divide-border">
        <ToggleRow
          id="auto-deploy-enabled"
          title="Deploy on push"
          description="Trigger a deployment whenever the tracked branch receives a commit."
          checked={autoSettings.autoDeployEnabled}
          onCheckedChange={(value) =>
            void handleSwitchChange("autoDeployEnabled", value)
          }
        />
        <ToggleRow
          id="post-commit-status"
          title="Post status on PR"
          description="Report build outcome to the Git provider."
          checked={autoSettings.postCommitStatus}
          onCheckedChange={(value) =>
            void handleSwitchChange("postCommitStatus", value)
          }
        />
        <ToggleRow
          id="coalesce-pushes"
          title="Coalesce rapid pushes"
          description="Collapse bursts of commits into a single deployment."
          checked={autoSettings.coalescePushes}
          onCheckedChange={(value) =>
            void handleSwitchChange("coalescePushes", value)
          }
        />
        <ToggleRow
          id="deploy-on-tag"
          title="Deploy on tag"
          description="Also deploy when a matching tag is pushed."
          checked={autoSettings.deployOnTag}
          onCheckedChange={(value) =>
            void handleSwitchChange("deployOnTag", value)
          }
        />

        {autoSettings.deployOnTag ? (
          <div className="flex flex-col gap-2 pt-4">
            <Label htmlFor="tag-pattern">Tag pattern</Label>
            <Input
              id="tag-pattern"
              value={autoSettings.tagPattern ?? ""}
              placeholder="v* or release-*"
              className="font-mono"
              onChange={(event) => {
                const value = event.target.value
                setAutoSettings((previous) => ({
                  ...previous,
                  tagPattern: value || undefined,
                }))
              }}
              onBlur={() =>
                void handleSwitchChange(
                  "tagPattern",
                  autoSettings.tagPattern ?? ""
                )
              }
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function DeployHooksCard({
  appId,
  app,
}: {
  appId: string
  app: AppDetail
}): React.JSX.Element {
  const update = useUpdateAppSettings(appId)
  const [editing, setEditing] = React.useState(false)
  const [preHook, setPreHook] = React.useState(app.hooksPreDeploy ?? "")
  const [postHook, setPostHook] = React.useState(app.hooksPostDeploy ?? "")
  const [timeoutS, setTimeoutS] = React.useState(
    String(app.hooksTimeoutS ?? 300)
  )
  const [formError, setFormError] = React.useState<string | null>(null)

  React.useEffect(() => {
    setPreHook(app.hooksPreDeploy ?? "")
    setPostHook(app.hooksPostDeploy ?? "")
    setTimeoutS(String(app.hooksTimeoutS ?? 300))
  }, [app.hooksPreDeploy, app.hooksPostDeploy, app.hooksTimeoutS])

  const handleCancel = (): void => {
    setEditing(false)
    setFormError(null)
    setPreHook(app.hooksPreDeploy ?? "")
    setPostHook(app.hooksPostDeploy ?? "")
    setTimeoutS(String(app.hooksTimeoutS ?? 300))
  }

  const handleSave = async (): Promise<void> => {
    setFormError(null)
    const parsedTimeout = Number.parseInt(timeoutS, 10)
    try {
      await update.mutateAsync({
        hooksPreDeploy: preHook.trim() || null,
        hooksPostDeploy: postHook.trim() || null,
        hooksTimeoutS: Number.isFinite(parsedTimeout) ? parsedTimeout : 300,
      })
      setEditing(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Save failed")
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deploy hooks</CardTitle>
        <CardDescription>
          Shell commands run inside the new container around the blue-green
          swap. Pre-deploy failure aborts the deploy.
        </CardDescription>
        <CardAction>
          {!editing ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
          ) : null}
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="hook-pre">Pre-deploy</Label>
          {editing ? (
            <Textarea
              id="hook-pre"
              value={preHook}
              placeholder="./scripts/migrate.sh"
              className="font-mono text-sm"
              rows={3}
              onChange={(e) => setPreHook(e.target.value)}
            />
          ) : (
            <ReadOnlyValue value={preHook} placeholder="None" mono />
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="hook-post">Post-deploy</Label>
          {editing ? (
            <Textarea
              id="hook-post"
              value={postHook}
              placeholder="./scripts/smoke-test.sh"
              className="font-mono text-sm"
              rows={3}
              onChange={(e) => setPostHook(e.target.value)}
            />
          ) : (
            <ReadOnlyValue value={postHook} placeholder="None" mono />
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="hook-timeout">Timeout (seconds)</Label>
          {editing ? (
            <Input
              id="hook-timeout"
              type="number"
              min={10}
              max={3600}
              value={timeoutS}
              placeholder="300"
              className="font-mono"
              onChange={(e) => setTimeoutS(e.target.value)}
            />
          ) : (
            <ReadOnlyValue value={`${timeoutS}s`} placeholder="300s" mono />
          )}
        </div>

        {formError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not save hooks</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>

      {editing ? (
        <CardFooter className="justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={handleCancel}
            disabled={update.isPending}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => void handleSave()}
            disabled={update.isPending}
          >
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  )
}

function ToggleRow({
  id,
  title,
  description,
  checked,
  onCheckedChange,
}: {
  id: string
  title: string
  description: string
  checked: boolean
  onCheckedChange: (value: boolean) => void
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id} className="cursor-pointer">
          {title}
        </Label>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        aria-label={title}
        onCheckedChange={onCheckedChange}
      />
    </div>
  )
}

function ReadOnlyValue({
  value,
  placeholder,
  mono = false,
}: {
  value: string
  placeholder: string
  mono?: boolean
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "min-w-0 rounded-md border bg-muted/40 px-3 py-2 text-sm",
        mono && "font-mono",
        value ? "text-foreground" : "text-muted-foreground"
      )}
    >
      <span className="block truncate">{value || placeholder}</span>
    </div>
  )
}
