// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useParams, createFileRoute } from "@tanstack/react-router"
import {
  RiExternalLinkLine,
  RiGitBranchLine,
  RiGitCommitLine,
  RiGithubFill,
  RiGitlabFill,
  RiGlobalLine,
} from "@remixicon/react"
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
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import { ChannelList } from "../../../../../../components/notifications/ChannelList"
import { useApp } from "../../../../../../lib/apps"
import type { AppDetail, AppSettingsPatch } from "../../../../../../lib/apps"
import { useUpdateAppSettings } from "../../../../../../lib/apps-mutations"

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
  { value: "static", label: "Static site" },
]

const FIELDS: Array<FieldDef> = [
  { key: "branch", label: "Branch", placeholder: "main" },
  { key: "rootDir", label: "Root directory", placeholder: "/", mono: true },
  {
    key: "buildMethod",
    label: "Build method",
    placeholder: "auto",
    hint: "auto · dockerfile · nixpacks · railpack · static",
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
  }, [app])

  if (isLoading) {
    return (
      <div className="w-full px-4 py-6 md:px-8 md:py-8">
        <SettingsSkeleton />
      </div>
    )
  }

  if (error || !app) {
    return (
      <div className="w-full px-4 py-6 md:px-8 md:py-8">
        <Alert variant="destructive">
          <AlertTitle>Failed to load settings</AlertTitle>
          <AlertDescription>
            {error?.message ?? "The application was not found."}
          </AlertDescription>
        </Alert>
      </div>
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

  return (
    <div className="w-full px-4 py-6 md:px-8 md:py-8">
      <div className="grid w-full gap-6 sm:grid-cols-2 xl:grid-cols-3">
        <SourceCard app={app} />

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

        <div className="sm:col-span-2 xl:col-span-3">
          <ChannelList appId={id} />
        </div>
      </div>
    </div>
  )
}

function SourceCard({ app }: { app: AppDetail }): React.JSX.Element {
  const repoHref = buildRepoHref(app.gitProvider, app.repoFullName)
  const commitShort = app.currentCommitSha
    ? app.currentCommitSha.slice(0, 7)
    : null
  const commitHref =
    repoHref && app.currentCommitSha
      ? `${repoHref}/commit/${app.currentCommitSha}`
      : undefined
  const branchHref =
    repoHref && app.branch ? `${repoHref}/tree/${app.branch}` : undefined
  const ProviderIcon =
    app.gitProvider === "gitlab" ? RiGitlabFill : RiGithubFill

  return (
    <Card className="sm:col-span-2 xl:col-span-3">
      <CardHeader>
        <CardTitle>Source & domain</CardTitle>
        <CardDescription>
          Repository, current branch, latest deployed commit, and live URL.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <InfoTile
          label="Repository"
          value={app.repoFullName ?? "—"}
          href={repoHref}
          icon={<ProviderIcon className="size-3.5" aria-hidden="true" />}
        />
        <InfoTile
          label="Branch"
          value={app.branch ?? "main"}
          href={branchHref}
          mono
          icon={<RiGitBranchLine className="size-3.5" aria-hidden="true" />}
        />
        <InfoTile
          label="Current commit"
          value={commitShort ?? "—"}
          title={app.currentCommitSha ?? undefined}
          href={commitHref}
          mono
          icon={<RiGitCommitLine className="size-3.5" aria-hidden="true" />}
        />
        <InfoTile
          label="Domain"
          value={app.domain ?? "Not set"}
          href={app.publicUrl ?? undefined}
          muted={!app.domain}
          icon={<RiGlobalLine className="size-3.5" aria-hidden="true" />}
        />
      </CardContent>
    </Card>
  )
}

function buildRepoHref(
  provider: string | undefined,
  repoFullName: string | undefined
): string | undefined {
  if (!repoFullName) return undefined
  if (provider === "gitlab") return `https://gitlab.com/${repoFullName}`
  return `https://github.com/${repoFullName}`
}

function InfoTile({
  label,
  value,
  href,
  title,
  mono,
  muted,
  icon,
}: {
  label: string
  value: string
  href?: string
  title?: string
  mono?: boolean
  muted?: boolean
  icon?: React.ReactNode
}): React.JSX.Element {
  const valueClass = cn(
    "min-w-0 truncate text-sm",
    mono ? "font-mono" : "font-medium",
    muted ? "text-muted-foreground" : "text-foreground"
  )

  return (
    <div className="min-w-0 rounded-md border bg-muted/40 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {icon}
        {label}
      </p>
      <div className="mt-1.5 min-w-0">
        {href ? (
          <a
            className={cn(
              valueClass,
              "inline-flex max-w-full items-center gap-1.5 hover:underline"
            )}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={title ?? value}
          >
            <span className="truncate">{value}</span>
            <RiExternalLinkLine
              className="size-3 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          </a>
        ) : (
          <p className={valueClass} title={title ?? value}>
            {value}
          </p>
        )}
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

function SettingsSkeleton(): React.JSX.Element {
  return (
    <div className="grid w-full gap-6 sm:grid-cols-2 xl:grid-cols-3">
      <Card className="sm:col-span-2 xl:col-span-3">
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-md" />
          ))}
        </CardContent>
      </Card>
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
  "/_authed/orgs/$orgSlug/apps/$id/settings"
)({
  component: AppSettingsGeneral,
})
