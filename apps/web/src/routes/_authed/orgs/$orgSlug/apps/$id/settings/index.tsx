// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useParams, createFileRoute } from "@tanstack/react-router"
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Textarea } from "@workspace/ui/components/textarea"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Switch } from "@workspace/ui/components/switch"
import { cn } from "@workspace/ui/lib/utils"
import { ChannelList } from "../../../../../../../components/notifications/ChannelList"
import { useApp } from "../../../../../../../lib/apps"
import type { AppSettingsPatch } from "../../../../../../../lib/apps"
import { useUpdateAppSettings } from "../../../../../../../lib/apps-mutations"
import { patchAppSettings } from "../../../../../../../lib/webhooks"
import type { AutoDeploySettings } from "../../../../../../../lib/webhooks"

interface AppAutoDeployFields {
  autoDeployEnabled?: boolean
  postCommitStatus?: boolean
  coalescePushes?: boolean
  deployOnTag?: boolean
  tagPattern?: string
}

type StringPatchKey = Exclude<
  keyof AppSettingsPatch,
  | "runtimePort"
  | "healthcheckPort"
  | "autoDeployEnabled"
  | "postCommitStatus"
  | "coalescePushes"
  | "deployOnTag"
  | "tagPattern"
  | "hooksPreDeploy"
  | "hooksPostDeploy"
  | "hooksTimeoutS"
>

interface FieldDef {
  key: StringPatchKey
  label: string
  placeholder: string
  hint?: string
  mono?: boolean
  options?: Array<FieldOption>
}

interface FieldOption {
  value: string
  label: string
}

const BUILD_METHOD_OPTIONS: Array<FieldOption> = [
  { value: "auto", label: "Auto-detect" },
  { value: "dockerfile", label: "Dockerfile" },
  { value: "nixpacks", label: "Nixpacks" },
  { value: "railpack", label: "Railpack" },
]

const FIELDS: Array<FieldDef> = [
  { key: "branch", label: "Branch", placeholder: "main" },
  { key: "rootDir", label: "Root directory", placeholder: "/", mono: true },
  {
    key: "buildMethod",
    label: "Build method",
    placeholder: "auto",
    hint: "auto · dockerfile · nixpacks · railpack",
    mono: true,
    options: BUILD_METHOD_OPTIONS,
  },
  {
    key: "dockerfilePath",
    label: "Dockerfile path",
    placeholder: "Dockerfile",
    mono: true,
  },
  {
    key: "nixpacksConfigPath",
    label: "Nixpacks config",
    placeholder: "nixpacks.toml",
    mono: true,
  },
  { key: "nodeVersion", label: "Node version", placeholder: "22", mono: true },
  {
    key: "installCommand",
    label: "Install command",
    placeholder: "npm install",
    mono: true,
  },
  {
    key: "buildCommand",
    label: "Build command",
    placeholder: "npm run build",
    mono: true,
  },
  {
    key: "startCommand",
    label: "Start command",
    placeholder: "npm start",
    mono: true,
  },
  {
    key: "healthcheckPath",
    label: "Healthcheck path",
    placeholder: "/",
    mono: true,
  },
]

function AppSettingsGeneral(): React.JSX.Element {
  const { id } = useParams({ strict: false }) as { id: string }
  const { data: app, isLoading, error } = useApp(id)
  const update = useUpdateAppSettings(id)

  const [editing, setEditing] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [formData, setFormData] = React.useState<AppSettingsPatch>({})

  const [autoSettings, setAutoSettings] = React.useState<AutoDeploySettings>({
    autoDeployEnabled: true,
    postCommitStatus: true,
    coalescePushes: true,
    deployOnTag: false,
    tagPattern: undefined,
  })

  React.useEffect(() => {
    if (!app) return

    setFormData({
      branch: app.branch,
      rootDir: app.rootDir,
      dockerfilePath: app.dockerfilePath,
      nixpacksConfigPath: app.nixpacksConfigPath,
      nodeVersion: app.nodeVersion,
      installCommand: app.installCommand,
      buildCommand: app.buildCommand,
      startCommand: app.startCommand,
      buildMethod: app.buildMethod,
      runtimePort: app.runtimePort,
      healthcheckPath: app.healthcheckPath,
      healthcheckPort: app.healthcheckPort,
    })

    const fields = app as typeof app & AppAutoDeployFields
    setAutoSettings({
      autoDeployEnabled: fields.autoDeployEnabled ?? true,
      postCommitStatus: fields.postCommitStatus ?? true,
      coalescePushes: fields.coalescePushes ?? true,
      deployOnTag: fields.deployOnTag ?? false,
      tagPattern: fields.tagPattern ?? undefined,
    })
  }, [app])

  if (isLoading) return <SettingsSkeleton />

  if (error || !app) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Failed to load settings</AlertTitle>
        <AlertDescription>
          {error?.message ?? "The application was not found."}
        </AlertDescription>
      </Alert>
    )
  }

  const resetForm = (): void => {
    setFormData({
      branch: app.branch,
      rootDir: app.rootDir,
      dockerfilePath: app.dockerfilePath,
      nixpacksConfigPath: app.nixpacksConfigPath,
      nodeVersion: app.nodeVersion,
      installCommand: app.installCommand,
      buildCommand: app.buildCommand,
      startCommand: app.startCommand,
      buildMethod: app.buildMethod,
      runtimePort: app.runtimePort,
      healthcheckPath: app.healthcheckPath,
      healthcheckPort: app.healthcheckPort,
    })
  }

  const handleCancel = (): void => {
    setEditing(false)
    setFormError(null)
    resetForm()
  }

  const handleSave = async (): Promise<void> => {
    setFormError(null)
    try {
      await update.mutateAsync(formData)
      setEditing(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Save failed")
    }
  }

  const handleSwitchChange = async (
    key: keyof AutoDeploySettings,
    value: boolean | string
  ): Promise<void> => {
    const previous = { ...autoSettings }
    const next = { ...autoSettings, [key]: value }
    setAutoSettings(next)

    try {
      await patchAppSettings(id, { [key]: value })
      toast.success("Setting updated")
    } catch (err) {
      setAutoSettings(previous)
      toast.error(err instanceof Error ? err.message : "Update failed")
    }
  }

  return (
    <div className="grid w-full gap-6 sm:grid-cols-2 xl:grid-cols-3">
      <Card className="sm:col-span-2 xl:col-span-2">
        <CardHeader>
          <CardTitle>Build & runtime</CardTitle>
          <CardDescription>
            Commands and paths used by the deployment pipeline.
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

        <CardContent className="grid gap-4 md:grid-cols-2">
          {FIELDS.map((field) => (
            <SettingsField
              key={field.key}
              field={field}
              value={String(formData[field.key] ?? "")}
              editing={editing}
              onChange={(value) =>
                setFormData((previous) => ({
                  ...previous,
                  [field.key]: value || undefined,
                }))
              }
            />
          ))}

          <PortField
            inputId="setting-runtime-port"
            label="Runtime port"
            value={formData.runtimePort ?? null}
            editing={editing}
            onChange={(value) =>
              setFormData((previous) => ({ ...previous, runtimePort: value }))
            }
          />

          <PortField
            inputId="setting-healthcheck-port"
            label="Healthcheck port"
            hint="Leave empty to reuse runtime port"
            value={formData.healthcheckPort ?? null}
            editing={editing}
            onChange={(value) =>
              setFormData((previous) => ({
                ...previous,
                healthcheckPort: value,
              }))
            }
          />

          {formError ? (
            <Alert variant="destructive" className="md:col-span-2">
              <AlertTitle>Could not save</AlertTitle>
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

      <DeployHooksCard appId={id} app={app} />

      <div className="sm:col-span-2 xl:col-span-3">
        <ChannelList appId={id} />
      </div>
    </div>
  )
}

function SettingsField({
  field,
  value,
  editing,
  onChange,
}: {
  field: FieldDef
  value: string
  editing: boolean
  onChange: (value: string) => void
}): React.JSX.Element {
  const inputId = `setting-${field.key}`
  const displayValue = getFieldDisplayValue(field, value)
  const normalizedValue = normalizeFieldValue(field, value)
  const hasUnsupportedValue =
    Boolean(value) &&
    Boolean(field.options) &&
    !field.options?.some((option) => option.value === normalizedValue)

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={inputId}>{field.label}</Label>
      {editing && field.options && !hasUnsupportedValue ? (
        <Select value={normalizedValue} onValueChange={onChange}>
          <SelectTrigger
            id={inputId}
            className={cn(field.mono && "font-mono")}
            aria-label={field.label}
          >
            <SelectValue placeholder={field.placeholder} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {field.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      ) : editing ? (
        <Input
          id={inputId}
          type="text"
          value={value}
          placeholder={field.placeholder}
          className={cn(field.mono && "font-mono")}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <ReadOnlyValue
          value={displayValue}
          placeholder={field.placeholder}
          mono={field.mono}
        />
      )}
      {field.hint ? (
        <p className="text-xs text-muted-foreground">{field.hint}</p>
      ) : null}
    </div>
  )
}

function normalizeFieldValue(field: FieldDef, value: string): string {
  if (field.key === "buildMethod") {
    if (!value) return "auto"
    return value === "docker" ? "dockerfile" : value
  }
  return value
}

function getFieldDisplayValue(field: FieldDef, value: string): string {
  const normalizedValue = normalizeFieldValue(field, value)
  return (
    field.options?.find((option) => option.value === normalizedValue)?.label ??
    value
  )
}

function PortField({
  inputId,
  label,
  hint,
  value,
  editing,
  onChange,
}: {
  inputId: string
  label: string
  hint?: string
  value: number | null
  editing: boolean
  onChange: (value: number | null) => void
}): React.JSX.Element {
  const displayValue = value != null ? String(value) : ""

  const handleChange = (raw: string): void => {
    if (raw.trim() === "") {
      onChange(null)
      return
    }
    const parsed = Number.parseInt(raw, 10)
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 65535) {
      onChange(parsed)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={inputId}>{label}</Label>
      {editing ? (
        <Input
          id={inputId}
          type="number"
          min={1}
          max={65535}
          value={displayValue}
          placeholder="3000"
          className="font-mono"
          onChange={(event) => handleChange(event.target.value)}
        />
      ) : (
        <ReadOnlyValue value={displayValue} placeholder="3000" mono />
      )}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
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

function DeployHooksCard({
  appId,
  app,
}: {
  appId: string
  app: import("../../../../../../../lib/apps").AppDetail
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

function SettingsSkeleton(): React.JSX.Element {
  return (
    <div className="grid w-full gap-6 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <Card
          key={index}
          className={index === 0 ? "sm:col-span-2 xl:col-span-2" : undefined}
        >
          <CardHeader>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-72" />
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export const Route = createFileRoute(
  "/_authed/orgs/$orgSlug/apps/$id/settings/"
)({
  component: AppSettingsGeneral,
})
