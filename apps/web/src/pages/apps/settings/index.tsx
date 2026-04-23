// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useParams } from "@tanstack/react-router"
import {
  RiCheckboxCircleLine,
  RiGitBranchLine,
  RiPulseLine,
  RiRocket2Line,
  RiTerminalBoxLine,
  RiTimeLine,
} from "@remixicon/react"
import { toast } from "sonner"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"
import { Separator } from "@workspace/ui/components/separator"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Switch } from "@workspace/ui/components/switch"
import { cn } from "@workspace/ui/lib/utils"
import { AppStatusBadge } from "../../../components/apps/AppStatusBadge"
import { useApp } from "../../../lib/apps"
import type { AppSettingsPatch } from "../../../lib/apps"
import { useUpdateAppSettings } from "../../../lib/apps-mutations"
import { patchAppSettings } from "../../../lib/webhooks"
import type { AutoDeploySettings } from "../../../lib/webhooks"

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
  description: string
  mono?: boolean
}

const FIELDS: Array<FieldDef> = [
  {
    key: "branch",
    label: "Branch",
    placeholder: "main",
    description: "Branch watched for automatic build decisions and previews.",
  },
  {
    key: "rootDir",
    label: "Root directory",
    placeholder: "/",
    description:
      "Relative path used as the workspace root before install and build.",
    mono: true,
  },
  {
    key: "dockerfilePath",
    label: "Dockerfile path",
    placeholder: "Dockerfile",
    description:
      "Explicit Dockerfile location when the app should not rely on autodetect.",
    mono: true,
  },
  {
    key: "nixpacksConfigPath",
    label: "Nixpacks config",
    placeholder: "nixpacks.toml",
    description:
      "Optional Nixpacks config file path when autodetect needs framework-specific overrides.",
    mono: true,
  },
  {
    key: "nodeVersion",
    label: "Node version",
    placeholder: "22",
    description: "Pinned Node version used by the Nixpacks builder.",
    mono: true,
  },
  {
    key: "installCommand",
    label: "Install command",
    placeholder: "npm install",
    description: "Dependency bootstrap command run before the build step.",
    mono: true,
  },
  {
    key: "buildCommand",
    label: "Build command",
    placeholder: "npm run build",
    description: "Compile or package command executed for each deployment.",
    mono: true,
  },
  {
    key: "startCommand",
    label: "Start command",
    placeholder: "npm start",
    description:
      "Entry command used to launch the runtime process after build.",
    mono: true,
  },
  {
    key: "buildMethod",
    label: "Build method",
    placeholder: "auto | docker | nixpacks",
    description: "Execution strategy used by Ploydok to build the app image.",
    mono: true,
  },
  {
    key: "healthcheckPath",
    label: "Healthcheck path",
    placeholder: "/",
    description:
      "HTTP path probed to confirm the app is ready after deployment.",
    mono: true,
  },
]

export function AppSettingsGeneral(): React.JSX.Element {
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

  const handleCancel = (): void => {
    setEditing(false)
    setFormError(null)
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
    <div className="grid w-full gap-6 md:grid-cols-2">
      <Card className="border border-border/70 bg-background/95">
        <CardHeader className="gap-3 border-b border-border/60 pb-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex max-w-2xl flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">Build Profile</Badge>
                <Badge variant="secondary">{app.buildMethod ?? "auto"}</Badge>
              </div>
              <CardTitle className="font-heading text-2xl">
                Build and runtime configuration
              </CardTitle>
              <CardDescription className="text-sm leading-6">
                Set the exact path, commands, and health endpoint used by the
                deployment pipeline. The read mode is intentionally compact;
                edit mode expands into a cleaner operator form.
              </CardDescription>
            </div>

            <CardAction>
              {!editing ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing(true)}
                >
                  Edit profile
                </Button>
              ) : null}
            </CardAction>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4 py-5">
          <FieldGroup>
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

            <HealthcheckPortField
              inputId="setting-runtime-port"
              label="Runtime port"
              description="Port exposed by the application process inside the container."
              value={formData.runtimePort ?? null}
              editing={editing}
              onChange={(value) =>
                setFormData((previous) => ({
                  ...previous,
                  runtimePort: value,
                }))
              }
            />

            <HealthcheckPortField
              inputId="setting-healthcheck-port"
              label="Healthcheck port"
              description="Optional readiness probe port. Leave empty to probe the runtime port."
              value={formData.healthcheckPort ?? null}
              editing={editing}
              onChange={(value) =>
                setFormData((previous) => ({
                  ...previous,
                  healthcheckPort: value,
                }))
              }
            />
          </FieldGroup>

          {formError ? (
            <Alert variant="destructive">
              <AlertTitle>Could not save the profile</AlertTitle>
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>

        {editing ? (
          <CardFooter className="justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
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
              {update.isPending ? "Saving..." : "Save changes"}
            </Button>
          </CardFooter>
        ) : null}
      </Card>

      <Card className="border border-border/70 bg-background/95">
        <CardHeader className="gap-3 border-b border-border/60 pb-5">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={
                  autoSettings.autoDeployEnabled ? "secondary" : "outline"
                }
              >
                {autoSettings.autoDeployEnabled
                  ? "Auto deploy on"
                  : "Auto deploy off"}
              </Badge>
              {autoSettings.coalescePushes ? (
                <Badge variant="outline">Coalescing enabled</Badge>
              ) : null}
            </div>
            <CardTitle className="font-heading text-2xl">
              Delivery automation
            </CardTitle>
            <CardDescription className="text-sm leading-6">
              Control when pushes become deployments and how webhook traffic is
              reduced before it reaches the build queue.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4 py-5">
          <div className="flex flex-col gap-3">
            <AutoDeployToggle
              id="auto-deploy-enabled"
              title="Redeploy automatically on each push"
              description="Create a deployment whenever the tracked branch receives a new commit."
              checked={autoSettings.autoDeployEnabled}
              onCheckedChange={(value) =>
                void handleSwitchChange("autoDeployEnabled", value)
              }
            />
            <AutoDeployToggle
              id="post-commit-status"
              title="Post build status on pull request"
              description="Report build outcomes back to the provider so reviewers see deployment health immediately."
              checked={autoSettings.postCommitStatus}
              onCheckedChange={(value) =>
                void handleSwitchChange("postCommitStatus", value)
              }
            />
            <AutoDeployToggle
              id="coalesce-pushes"
              title="Merge rapid pushes"
              description="Collapse bursts of commits into one effective deployment request to keep the queue stable."
              checked={autoSettings.coalescePushes}
              onCheckedChange={(value) =>
                void handleSwitchChange("coalescePushes", value)
              }
            />
            <AutoDeployToggle
              id="deploy-on-tag"
              title="Deploy on tag push"
              description="Listen to matching tag references in addition to the main tracked branch."
              checked={autoSettings.deployOnTag}
              onCheckedChange={(value) =>
                void handleSwitchChange("deployOnTag", value)
              }
            />
          </div>

          {autoSettings.deployOnTag ? (
            <>
              <Separator />
              <FieldGroup>
                <Field className="rounded-2xl border border-border/70 bg-muted/30 p-4">
                  <FieldContent className="gap-1">
                    <FieldLabel htmlFor="tag-pattern">Tag pattern</FieldLabel>
                    <FieldDescription>
                      Optional pattern used to limit which tags can trigger a
                      deployment.
                    </FieldDescription>
                  </FieldContent>
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
                </Field>
              </FieldGroup>
            </>
          ) : null}
        </CardContent>
      </Card>

      <DeployHooksCard appId={id} app={app} />

      <Card className="relative overflow-hidden border border-border/70 bg-background/95">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_top_left,var(--color-chart-1),transparent_36%),radial-gradient(circle_at_bottom_right,var(--color-muted),transparent_42%)] opacity-20"
        />
        <CardHeader className="relative gap-3 border-b border-border/60 pb-5">
          <Badge variant="outline" className="w-fit">
            Runtime Snapshot
          </Badge>
          <CardTitle className="font-heading text-xl">
            Current deployment posture
          </CardTitle>
          <CardDescription>
            A quick read on the values that matter when something behaves
            differently in production.
          </CardDescription>
        </CardHeader>
        <CardContent className="relative flex flex-col gap-3 py-5">
          <InsightRow
            label="Status"
            value={<AppStatusBadge status={app.status} />}
            icon={<RiRocket2Line className="size-4" />}
          />
          <InsightRow
            label="Tracked branch"
            value={app.branch ?? "main"}
            icon={<RiGitBranchLine className="size-4" />}
          />
          <InsightRow
            label="Build method"
            value={app.buildMethod ?? "auto"}
            icon={<RiTerminalBoxLine className="size-4" />}
          />
          <InsightRow
            label="Healthcheck"
            value={`${app.healthcheckPath ?? "/"} · ${app.healthcheckPort ?? 3000}`}
            icon={<RiPulseLine className="size-4" />}
          />
        </CardContent>
      </Card>

      <Card size="sm" className="border border-border/70 bg-muted/30">
        <CardHeader className="gap-2">
          <CardTitle>Decision checklist</CardTitle>
          <CardDescription>
            The routing path for incoming changes stays easy to reason about.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ChecklistItem text="Tracked branch is aligned with the provider webhook." />
          <ChecklistItem text="Build/start commands reflect the current runtime." />
          <ChecklistItem text="Healthcheck path and port match the app listener." />
          <ChecklistItem text="Tag deploys are constrained when release branches coexist." />
        </CardContent>
      </Card>

      <Alert className="md:col-span-2">
        <RiTimeLine />
        <AlertTitle>Operator note</AlertTitle>
        <AlertDescription>
          Auto-deploy toggles save instantly. The build profile card keeps an
          explicit edit mode so command changes stay deliberate and reviewable.
        </AlertDescription>
      </Alert>
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
  return (
    <Field
      orientation="responsive"
      className="rounded-2xl border border-border/70 bg-background/80 p-4"
    >
      <FieldContent className="gap-1">
        <FieldLabel htmlFor={`setting-${field.key}`}>{field.label}</FieldLabel>
        <FieldDescription>{field.description}</FieldDescription>
      </FieldContent>

      {editing ? (
        <Input
          id={`setting-${field.key}`}
          type="text"
          value={value}
          placeholder={field.placeholder}
          className={cn(field.mono ? "font-mono" : "")}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <ReadOnlyValue
          value={value}
          placeholder={field.placeholder}
          mono={field.mono}
        />
      )}
    </Field>
  )
}

function HealthcheckPortField({
  inputId,
  label,
  description,
  value,
  editing,
  onChange,
}: {
  inputId: string
  label: string
  description: string
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
    <Field
      orientation="responsive"
      className="rounded-2xl border border-border/70 bg-background/80 p-4"
    >
      <FieldContent className="gap-1">
        <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
        <FieldDescription>{description}</FieldDescription>
      </FieldContent>

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
    </Field>
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
        "min-w-0 rounded-xl border border-border/70 bg-muted/30 px-3 py-2.5 text-sm font-medium",
        mono ? "font-mono" : "",
        value ? "text-foreground" : "text-muted-foreground italic"
      )}
    >
      <span className="block truncate">{value || placeholder}</span>
    </div>
  )
}

function AutoDeployToggle({
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
    <Field
      orientation="horizontal"
      className="items-start rounded-2xl border border-border/70 bg-background/80 px-4 py-4"
    >
      <FieldContent className="gap-1">
        <FieldLabel htmlFor={id}>{title}</FieldLabel>
        <FieldDescription>{description}</FieldDescription>
      </FieldContent>
      <Switch
        id={id}
        checked={checked}
        aria-label={title}
        onCheckedChange={onCheckedChange}
      />
    </Field>
  )
}

function InsightRow({
  label,
  value,
  icon,
}: {
  label: string
  value: React.ReactNode
  icon: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-background/85 px-3 py-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
          {label}
        </p>
        <div className="min-w-0 text-sm font-medium">{value}</div>
      </div>
    </div>
  )
}

function ChecklistItem({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="flex items-start gap-2 text-sm leading-6">
      <RiCheckboxCircleLine className="mt-1 size-4 shrink-0 text-muted-foreground" />
      <span>{text}</span>
    </div>
  )
}

function DeployHooksCard({
  appId,
  app,
}: {
  appId: string
  app: import("../../../lib/apps").AppDetail
}): React.JSX.Element {
  const update = useUpdateAppSettings(appId)
  const [editing, setEditing] = React.useState(false)
  const [preHook, setPreHook] = React.useState(app.hooksPreDeploy ?? "")
  const [postHook, setPostHook] = React.useState(app.hooksPostDeploy ?? "")
  const [timeoutS, setTimeoutS] = React.useState(String(app.hooksTimeoutS ?? 300))
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
    <Card className="border border-border/70 bg-background/95">
      <CardHeader className="gap-3 border-b border-border/60 pb-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex max-w-2xl flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">Deploy Hooks</Badge>
              {(app.hooksPreDeploy || app.hooksPostDeploy) ? (
                <Badge variant="secondary">Active</Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">None configured</Badge>
              )}
            </div>
            <CardTitle className="font-heading text-2xl">
              Pre and post-deploy hooks
            </CardTitle>
            <CardDescription className="text-sm leading-6">
              Shell commands run inside the just-built container before (pre) and
              after (post) the blue-green swap. Pre-deploy failure aborts the
              deploy. Post-deploy failure marks the build succeeded-with-warning.
            </CardDescription>
          </div>
          <CardAction>
            {!editing ? (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                Edit hooks
              </Button>
            ) : null}
          </CardAction>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4 py-5">
        <FieldGroup>
          <Field
            orientation="vertical"
            className="rounded-2xl border border-border/70 bg-background/80 p-4"
          >
            <FieldContent className="gap-1">
              <FieldLabel htmlFor="hook-pre">Pre-deploy command</FieldLabel>
              <FieldDescription>
                Runs before the Caddy swap. Non-zero exit aborts the deployment.
              </FieldDescription>
            </FieldContent>
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
              <div className="rounded-xl border border-border/70 bg-muted/30 px-3 py-2.5 font-mono text-sm text-muted-foreground">
                {preHook || <span className="italic">None</span>}
              </div>
            )}
          </Field>

          <Field
            orientation="vertical"
            className="rounded-2xl border border-border/70 bg-background/80 p-4"
          >
            <FieldContent className="gap-1">
              <FieldLabel htmlFor="hook-post">Post-deploy command</FieldLabel>
              <FieldDescription>
                Runs after the swap succeeds. Failure marks build as succeeded-with-warning.
              </FieldDescription>
            </FieldContent>
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
              <div className="rounded-xl border border-border/70 bg-muted/30 px-3 py-2.5 font-mono text-sm text-muted-foreground">
                {postHook || <span className="italic">None</span>}
              </div>
            )}
          </Field>

          <Field
            orientation="responsive"
            className="rounded-2xl border border-border/70 bg-background/80 p-4"
          >
            <FieldContent className="gap-1">
              <FieldLabel htmlFor="hook-timeout">Hook timeout (seconds)</FieldLabel>
              <FieldDescription>
                Maximum time before the hook container is force-removed (default 300s).
              </FieldDescription>
            </FieldContent>
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
              <div className="min-w-0 rounded-xl border border-border/70 bg-muted/30 px-3 py-2.5 font-mono text-sm font-medium">
                {timeoutS}s
              </div>
            )}
          </Field>
        </FieldGroup>

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
            variant="outline"
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
            {update.isPending ? "Saving..." : "Save hooks"}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  )
}

function SettingsSkeleton(): React.JSX.Element {
  return (
    <div className="grid w-full gap-6 md:grid-cols-2">
      <Card className="border border-border/70 bg-background/95">
        <CardHeader className="gap-3">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-full max-w-2xl" />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-20 rounded-2xl" />
          ))}
        </CardContent>
      </Card>
      <Card className="border border-border/70 bg-background/95">
        <CardHeader className="gap-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-8 w-56" />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-16 rounded-xl" />
          ))}
        </CardContent>
      </Card>
      <Skeleton className="h-64 rounded-2xl" />
      <Skeleton className="h-56 rounded-2xl" />
      <Skeleton className="h-28 rounded-2xl md:col-span-2" />
    </div>
  )
}
