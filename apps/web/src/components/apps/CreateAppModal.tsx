// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import {
  RiArrowRightSLine,
  RiCheckLine,
  RiCloseLine,
  RiGithubFill,
  RiGitlabFill,
  RiInformationLine,
} from "@remixicon/react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { useCreateApp } from "../../lib/apps"
import { useGitHubBranches } from "../../lib/github"
import { useGitLabBranches } from "../../lib/gitlab"
import { useStackClassification } from "../../lib/stack-classifier-hook"
import { useRegistryCredentials } from "../../lib/registry-credentials"
import { RepoSelector } from "./RepoSelector"
import { GitLabRepoSelector } from "./GitLabRepoSelector"
import { PlanSelector  } from "./PlanSelector"
import type {PlanSelectorValue} from "./PlanSelector";
import type { AppConfig,
  BuildMethod,
  GitBranch,
  GitProviderKind,
  GitRepo,
  ImagePullPolicy,
  StackClassification } from "@ploydok/shared"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CreateAppModalProps {
  open: boolean
  organizationId?: string
  onClose: () => void
}

type SourceKind = GitProviderKind
type StepId = "source" | "build" | "resources"

interface FormState {
  name: string
  source: SourceKind
  selectedRepo: GitRepo | null
  branch: string
  imageRef: string
  imagePullPolicy: ImagePullPolicy
  registryCredentialId: string
  buildMethod: BuildMethod
  buildMethodTouched: boolean
  rootDir: string
  dockerfilePath: string
  installCommand: string
  buildCommand: string
  startCommand: string
  staticOutputDir: string
  staticSpaFallback: boolean
  watchPaths: string
  healthcheckPath: string
  healthcheckPort: string
  laravelSeedOnFirstDeploy: boolean
  plan: PlanSelectorValue
}

const INITIAL_FORM: FormState = {
  name: "",
  source: "github",
  selectedRepo: null,
  branch: "",
  imageRef: "",
  imagePullPolicy: "always",
  registryCredentialId: "",
  buildMethod: "auto",
  buildMethodTouched: false,
  rootDir: "",
  dockerfilePath: "",
  installCommand: "",
  buildCommand: "",
  startCommand: "",
  staticOutputDir: "dist",
  staticSpaFallback: true,
  watchPaths: "",
  healthcheckPath: "/",
  healthcheckPort: "",
  laravelSeedOnFirstDeploy: false,
  plan: { plan: "small" },
}

// ---------------------------------------------------------------------------
// CreateAppModal
// ---------------------------------------------------------------------------

export function CreateAppModal({
  open,
  organizationId,
  onClose,
}: CreateAppModalProps): React.JSX.Element | null {
  const [stepIdx, setStepIdx] = React.useState(0)
  const [form, setForm] = React.useState<FormState>(INITIAL_FORM)
  const [showAdvanced, setShowAdvanced] = React.useState(false)
  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const createApp = useCreateApp()

  const steps: Array<{ id: StepId; label: string; hint: string }> =
    form.source === "image"
      ? [
          { id: "source", label: "Source", hint: "Image OCI" },
          { id: "resources", label: "Ressources", hint: "Plan & quotas" },
        ]
      : [
          { id: "source", label: "Source", hint: "Repo & branche" },
          { id: "build", label: "Build", hint: "Méthode & options" },
          { id: "resources", label: "Ressources", hint: "Plan & quotas" },
        ]

  const currentStep = steps[stepIdx]?.id ?? "source"
  const totalSteps = steps.length

  const { data: ghBranches, isLoading: ghBranchesLoading } = useGitHubBranches(
    form.source === "github" ? form.selectedRepo?.fullName : undefined
  )
  const { data: glBranches, isLoading: glBranchesLoading } = useGitLabBranches(
    form.source === "gitlab" ? form.selectedRepo?.fullName : undefined
  )

  const classifierSource =
    form.source === "github" || form.source === "gitlab"
      ? form.source
      : undefined
  const classifier = useStackClassification(
    classifierSource,
    classifierSource ? form.selectedRepo?.fullName : undefined,
    form.branch || undefined
  )
  const classification = classifier.data ?? null
  const hasDockerfile =
    classification === null
      ? null
      : classification.recommendedBuild === "dockerfile"
  const detectionLoading = classifier.isLoading

  const branches: Array<GitBranch> =
    form.source === "github"
      ? (ghBranches ?? [])
      : form.source === "gitlab"
        ? (glBranches ?? [])
        : []
  const branchesLoading =
    form.source === "github"
      ? ghBranchesLoading
      : form.source === "gitlab"
        ? glBranchesLoading
        : false

  React.useEffect(() => {
    if (!open) {
      setStepIdx(0)
      setForm(INITIAL_FORM)
      setShowAdvanced(false)
      setSubmitError(null)
    }
  }, [open])

  React.useEffect(() => {
    if (branches.length > 0 && !form.branch) {
      const repoDefault = form.selectedRepo?.defaultBranch
      const defaultBranch =
        repoDefault !== undefined ? repoDefault : (branches[0]?.name ?? "")
      setForm((prev) => ({ ...prev, branch: defaultBranch }))
    }
  }, [branches, form.selectedRepo?.defaultBranch, form.branch])

  React.useEffect(() => {
    if (hasDockerfile === null) return
    setForm((prev) => {
      if (prev.buildMethodTouched) return prev
      const next: BuildMethod = hasDockerfile ? "docker" : "nixpacks"
      if (prev.buildMethod === next) return prev
      return { ...prev, buildMethod: next }
    })
  }, [hasDockerfile])

  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null

  const setField = <TKey extends keyof FormState>(
    key: TKey,
    value: FormState[TKey]
  ): void => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleSourceChange = (source: SourceKind): void => {
    setForm((prev) => ({
      ...prev,
      source,
      selectedRepo: null,
      branch: "",
    }))
    if (stepIdx > 0) setStepIdx(0)
  }

  const handleRepoSelect = (repo: GitRepo): void => {
    setForm((prev) => ({
      ...prev,
      selectedRepo: repo,
      branch: "",
      name: prev.name || (repo.fullName.split("/").at(-1) ?? ""),
      laravelSeedOnFirstDeploy: false,
    }))
  }

  const canGoNext = (): boolean => {
    if (currentStep === "source") {
      if (form.name.trim().length === 0) return false
      if (form.source === "image") return form.imageRef.trim().length > 0
      return form.selectedRepo !== null && form.branch.length > 0
    }
    return true
  }

  const handleSubmit = async (): Promise<void> => {
    setSubmitError(null)
    try {
      const body = buildCreateAppBody(form, organizationId)
      await createApp.mutateAsync(body as Partial<AppConfig>)
      onClose()
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Échec de la création de l'app"
      )
    }
  }

  const isLast = stepIdx === totalSteps - 1

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-app-title"
        className={cn(
          "fixed inset-x-2 top-1/2 z-50 -translate-y-1/2",
          "sm:inset-x-auto sm:left-1/2 sm:w-full sm:max-w-6xl sm:-translate-x-1/2",
          "rounded-2xl border border-border bg-background shadow-2xl",
          "flex h-[92vh] flex-col overflow-hidden sm:h-[88vh]",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <span className="text-sm font-semibold">+</span>
            </div>
            <div>
              <h2
                id="create-app-title"
                className="text-base leading-none font-semibold"
              >
                Nouvelle application
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Étape {stepIdx + 1} sur {totalSteps} · {steps[stepIdx]?.hint}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Fermer la fenêtre"
          >
            <RiCloseLine className="size-5" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 md:grid-cols-[220px_1fr]">
          <aside className="hidden min-h-0 overflow-y-auto border-r border-border bg-muted/30 p-4 md:block">
            <ol className="space-y-1">
              {steps.map((s, idx) => {
                const state =
                  idx < stepIdx ? "done" : idx === stepIdx ? "current" : "todo"
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (idx <= stepIdx) setStepIdx(idx)
                      }}
                      disabled={idx > stepIdx}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors",
                        state === "current" &&
                          "bg-background shadow-sm ring-1 ring-border",
                        state === "done" &&
                          "cursor-pointer hover:bg-background/60",
                        state === "todo" && "cursor-not-allowed opacity-60"
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold",
                          state === "current" &&
                            "border-primary bg-primary text-primary-foreground",
                          state === "done" &&
                            "border-primary/40 bg-primary/10 text-primary",
                          state === "todo" &&
                            "border-border text-muted-foreground"
                        )}
                      >
                        {state === "done" ? (
                          <RiCheckLine className="size-3" />
                        ) : (
                          idx + 1
                        )}
                      </span>
                      <span className="flex flex-col">
                        <span className="text-sm leading-none font-medium">
                          {s.label}
                        </span>
                        <span className="mt-1 text-[11px] text-muted-foreground">
                          {s.hint}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>

            <div className="my-4 h-px bg-border" />

            <SummaryCard form={form} />
          </aside>

          <div className="flex min-h-0 flex-col">
            <div
              key={currentStep}
              className="min-h-0 flex-1 overflow-y-auto p-4 motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in-0 motion-safe:slide-in-from-right-2 sm:p-6"
            >
              {currentStep === "source" && (
                <SourceStep
                  form={form}
                  setField={setField}
                  onSourceChange={handleSourceChange}
                  onRepoSelect={handleRepoSelect}
                  branches={branches}
                  branchesLoading={branchesLoading}
                />
              )}
              {currentStep === "build" && (
                <BuildStep
                  form={form}
                  setField={setField}
                  showAdvanced={showAdvanced}
                  onToggleAdvanced={() => setShowAdvanced((v) => !v)}
                  hasDockerfile={hasDockerfile}
                  detectionLoading={detectionLoading}
                  classification={classification}
                />
              )}
              {currentStep === "resources" && (
                <ResourcesStep
                  value={form.plan}
                  onChange={(v) => setField("plan", v)}
                />
              )}

              {submitError && (
                <div
                  role="alert"
                  className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                >
                  {submitError}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/20 px-4 py-3 sm:gap-3 sm:px-6 sm:py-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={
                  stepIdx === 0
                    ? onClose
                    : () => setStepIdx((s) => Math.max(0, s - 1))
                }
              >
                {stepIdx === 0 ? "Annuler" : "Précédent"}
              </Button>
              <div className="flex items-center gap-3">
                <span className="hidden text-[11px] text-muted-foreground sm:inline">
                  {stepIdx + 1} / {totalSteps}
                </span>
                {!isLast ? (
                  <Button
                    size="sm"
                    onClick={() =>
                      setStepIdx((s) => Math.min(totalSteps - 1, s + 1))
                    }
                    disabled={!canGoNext()}
                    className="gap-1"
                  >
                    Continuer
                    <RiArrowRightSLine className="size-4" />
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => void handleSubmit()}
                    disabled={createApp.isPending || !canGoNext()}
                  >
                    {createApp.isPending ? "Création…" : "Créer l'application"}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Sidebar — live summary
// ---------------------------------------------------------------------------

function SummaryCard({ form }: { form: FormState }): React.JSX.Element {
  const sourceLabel: Record<SourceKind, string> = {
    github: "GitHub",
    gitlab: "GitLab",
    image: "Image OCI",
  }

  return (
    <div className="space-y-2.5">
      <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
        Récapitulatif
      </p>
      <SummaryRow label="Nom" value={form.name || "—"} mono={!!form.name} />
      <SummaryRow label="Source" value={sourceLabel[form.source]} />
      {form.source !== "image" && (
        <>
          <SummaryRow
            label="Repo"
            value={form.selectedRepo?.fullName ?? "—"}
            mono={!!form.selectedRepo}
            truncate
          />
          <SummaryRow
            label="Branche"
            value={form.branch || "—"}
            mono={!!form.branch}
          />
          <SummaryRow
            label="Build"
            value={
              form.buildMethod === "auto"
                ? "auto"
                : form.buildMethod === "docker"
                  ? "Dockerfile"
                  : form.buildMethod === "static"
                    ? "Static site"
                  : "Nixpacks"
            }
          />
          {form.buildMethod === "static" && (
            <SummaryRow
              label="Output"
              value={form.staticOutputDir || "dist"}
              mono
            />
          )}
          {form.laravelSeedOnFirstDeploy && (
            <SummaryRow label="Laravel seed" value="first deploy" />
          )}
        </>
      )}
      {form.source === "image" && (
        <SummaryRow
          label="Image"
          value={form.imageRef || "—"}
          mono={!!form.imageRef}
          truncate
        />
      )}
      <SummaryRow label="Plan" value={form.plan.plan} />
    </div>
  )
}

function SummaryRow({
  label,
  value,
  mono,
  truncate,
}: {
  label: string
  value: string
  mono?: boolean
  truncate?: boolean
}): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "min-w-0 text-right",
          mono && "font-mono text-[11px]",
          truncate && "truncate"
        )}
        title={truncate ? value : undefined}
      >
        {value}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 1 — Source (name + provider + repo/image + branch)
// ---------------------------------------------------------------------------

interface SourceStepProps {
  form: FormState
  setField: <TKey extends keyof FormState>(
    key: TKey,
    value: FormState[TKey]
  ) => void
  onSourceChange: (s: SourceKind) => void
  onRepoSelect: (repo: GitRepo) => void
  branches: Array<GitBranch>
  branchesLoading: boolean
}

function SourceStep({
  form,
  setField,
  onSourceChange,
  onRepoSelect,
  branches,
  branchesLoading,
}: SourceStepProps): React.JSX.Element {
  const slug = form.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <label htmlFor="app-name" className="text-sm font-medium">
          Nom de l'application
        </label>
        <input
          id="app-name"
          type="text"
          placeholder="my-app"
          value={form.name}
          onChange={(e) => setField("name", e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:ring-2 focus:ring-ring focus:outline-none"
          autoFocus
        />
        <p className="text-xs text-muted-foreground">
          {slug ? (
            <>
              URL interne :{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                {slug}
              </code>
            </>
          ) : (
            <>
              Identifiant unique au sein de l'organisation. Slug auto-généré
              depuis le nom.
            </>
          )}
        </p>
      </section>

      <section className="space-y-2">
        <p className="text-sm font-medium">Source du déploiement</p>
        <ProviderTabs source={form.source} onChange={onSourceChange} />
      </section>

      {form.source === "github" && (
        <GitSection
          providerLabel="GitHub"
          selectedRepo={form.selectedRepo}
          branch={form.branch}
          onBranchChange={(v) => setField("branch", v)}
          branches={branches}
          branchesLoading={branchesLoading}
        >
          <RepoSelector selected={form.selectedRepo} onSelect={onRepoSelect} />
        </GitSection>
      )}

      {form.source === "gitlab" && (
        <GitSection
          providerLabel="GitLab"
          selectedRepo={form.selectedRepo}
          branch={form.branch}
          onBranchChange={(v) => setField("branch", v)}
          branches={branches}
          branchesLoading={branchesLoading}
        >
          <GitLabRepoSelector
            selected={form.selectedRepo}
            onSelect={onRepoSelect}
          />
        </GitSection>
      )}

      {form.source === "image" && (
        <ImageSection
          imageRef={form.imageRef}
          onImageRefChange={(v) => setField("imageRef", v)}
          imagePullPolicy={form.imagePullPolicy}
          onImagePullPolicyChange={(v) => setField("imagePullPolicy", v)}
          registryCredentialId={form.registryCredentialId}
          onRegistryCredentialIdChange={(v) =>
            setField("registryCredentialId", v)
          }
        />
      )}
    </div>
  )
}

function ProviderTabs({
  source,
  onChange,
}: {
  source: SourceKind
  onChange: (s: SourceKind) => void
}): React.JSX.Element {
  const tabs: Array<{
    id: SourceKind
    label: string
    hint: string
    icon: React.JSX.Element
  }> = [
    {
      id: "github",
      label: "GitHub",
      hint: "Auto-deploy sur push",
      icon: <RiGithubFill className="size-5" />,
    },
    {
      id: "gitlab",
      label: "GitLab",
      hint: "Auto-deploy sur push",
      icon: <RiGitlabFill className="size-5 text-[#FC6D26]" />,
    },
    {
      id: "image",
      label: "Image",
      hint: "Docker / OCI",
      icon: <DockerIcon className="size-5 text-[#1D63ED]" />,
    },
  ]

  return (
    <div
      role="tablist"
      aria-label="Source"
      className="grid gap-2 sm:grid-cols-3"
    >
      {tabs.map((t) => {
        const active = source === t.id
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={cn(
              "group relative flex items-center gap-3 rounded-lg border p-3 text-left transition-all",
              active
                ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20"
                : "border-border bg-card hover:border-primary/30 hover:bg-muted/40"
            )}
          >
            <span
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-md border",
                active
                  ? "border-primary/30 bg-background"
                  : "border-border bg-muted/40"
              )}
            >
              {t.icon}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-sm leading-none font-medium">
                {t.label}
              </span>
              <span className="mt-1 truncate text-[11px] text-muted-foreground">
                {t.hint}
              </span>
            </span>
            {active && (
              <RiCheckLine className="ml-auto size-4 shrink-0 text-primary" />
            )}
          </button>
        )
      })}
    </div>
  )
}

function GitSection({
  providerLabel,
  selectedRepo,
  branch,
  onBranchChange,
  branches,
  branchesLoading,
  children,
}: {
  providerLabel: string
  selectedRepo: GitRepo | null
  branch: string
  onBranchChange: (v: string) => void
  branches: Array<GitBranch>
  branchesLoading: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-medium">Dépôt {providerLabel}</p>
        {children}
      </div>

      {selectedRepo && (
        <div className="space-y-1.5">
          <label htmlFor="branch-select" className="text-sm font-medium">
            Branche
          </label>
          {branchesLoading ? (
            <div className="h-9 w-full animate-pulse rounded-md bg-muted" />
          ) : (
            <select
              id="branch-select"
              value={branch}
              onChange={(e) => onBranchChange(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:ring-2 focus:ring-ring focus:outline-none"
            >
              <option value="">Sélectionner une branche…</option>
              {branches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  )
}

interface ImageSectionProps {
  imageRef: string
  onImageRefChange: (v: string) => void
  imagePullPolicy: ImagePullPolicy
  onImagePullPolicyChange: (v: ImagePullPolicy) => void
  registryCredentialId: string
  onRegistryCredentialIdChange: (v: string) => void
}

function ImageSection({
  imageRef,
  onImageRefChange,
  imagePullPolicy,
  onImagePullPolicyChange,
  registryCredentialId,
  onRegistryCredentialIdChange,
}: ImageSectionProps): React.JSX.Element {
  const { data: credentials, isLoading } = useRegistryCredentials()

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="image-ref" className="text-sm font-medium">
          Référence de l'image
        </label>
        <input
          id="image-ref"
          type="text"
          placeholder="nginx:alpine"
          value={imageRef}
          onChange={(e) => onImageRefChange(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm shadow-sm focus:ring-2 focus:ring-ring focus:outline-none"
          autoFocus
        />
        <p className="text-xs text-muted-foreground">
          Exemples : <code className="font-mono text-[11px]">nginx:alpine</code>
          , <code className="font-mono text-[11px]">ghcr.io/org/app:v1</code>.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="registry-cred" className="text-sm font-medium">
          Credentials du registry
        </label>
        <select
          id="registry-cred"
          value={registryCredentialId}
          onChange={(e) => onRegistryCredentialIdChange(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:ring-2 focus:ring-ring focus:outline-none"
        >
          <option value="">Public / anonyme</option>
          {isLoading ? (
            <option disabled>Chargement…</option>
          ) : (
            (credentials ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} ({c.registryHost})
              </option>
            ))
          )}
        </select>
        <p className="text-xs text-muted-foreground">
          Gérer les credentials dans{" "}
          <a className="underline underline-offset-2" href="/settings/registry">
            Settings — Registry
          </a>
          .
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Politique de pull</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <ChoiceCard
            active={imagePullPolicy === "always"}
            onSelect={() => onImagePullPolicyChange("always")}
            label="Always"
            hint="Pull avant chaque déploiement"
          />
          <ChoiceCard
            active={imagePullPolicy === "if_not_present"}
            onSelect={() => onImagePullPolicyChange("if_not_present")}
            label="If not present"
            hint="Pull uniquement si absent localement"
          />
        </div>
      </fieldset>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 2 — Build
// ---------------------------------------------------------------------------

interface BuildStepProps {
  form: FormState
  setField: <TKey extends keyof FormState>(
    key: TKey,
    value: FormState[TKey]
  ) => void
  showAdvanced: boolean
  onToggleAdvanced: () => void
  hasDockerfile: boolean | null
  detectionLoading: boolean
  classification: StackClassification | null
}

function BuildStep({
  form,
  setField,
  showAdvanced,
  onToggleAdvanced,
  hasDockerfile,
  detectionLoading,
  classification,
}: BuildStepProps): React.JSX.Element {
  const selectMethod = (method: BuildMethod): void => {
    setField("buildMethod", method)
    setField("buildMethodTouched", true)
  }

  const isStaticBuild = form.buildMethod === "static"

  const nixpacksHint = ((): string => {
    if (hasDockerfile !== false) return "Force auto-pack (ignore le Dockerfile)"
    if (!classification)
      return "Auto-pack zero-config (Node / Next / Python / Rust / …)"
    switch (classification.stack) {
      case "laravel":
        return "Auto-pack PHP (nginx + php-fpm, Laravel-aware). Recipe managée recommandée pour la prod."
      case "symfony":
      case "php":
        return "Auto-pack PHP (nginx + php-fpm). Recipe managée recommandée pour la prod."
      case "next":
        return "Auto-pack Next.js (standalone output si configuré)."
      case "node":
      case "bun":
        return "Auto-pack Node — pense à fixer NIXPACKS_NODE_VERSION."
      case "django":
      case "flask":
      case "fastapi":
      case "python":
        return "Auto-pack Python (gunicorn/uvicorn selon framework)."
      case "compose":
        return "Compose détecté — support natif prévu sprint 3.3. Nixpacks buildera le service principal en fallback."
      default:
        return "Auto-pack zero-config (Node / Next / Python / Rust / …)"
    }
  })()

  return (
    <div className="space-y-5">
      {classification && classification.stack !== "unknown" && (
        <DetectedPanel classification={classification} />
      )}

      {classification?.stack === "laravel" && (
        <LaravelRuntimePanel
          seedOnFirstDeploy={form.laravelSeedOnFirstDeploy}
          onSeedOnFirstDeployChange={(value) =>
            setField("laravelSeedOnFirstDeploy", value)
          }
        />
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Méthode de build</p>
          {detectionLoading && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <span className="size-1.5 animate-pulse rounded-full bg-primary" />
              Détection…
            </span>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <BuildMethodCard
            label="Dockerfile"
            hint={
              hasDockerfile === true
                ? "Build via le Dockerfile à la racine"
                : hasDockerfile === false
                  ? "Aucun Dockerfile détecté sur cette branche"
                  : "Build via Dockerfile"
            }
            active={form.buildMethod === "docker"}
            detected={hasDockerfile === true}
            onSelect={() => selectMethod("docker")}
          />
          <BuildMethodCard
            label="Nixpacks"
            hint={nixpacksHint}
            active={form.buildMethod === "nixpacks"}
            detected={hasDockerfile === false}
            onSelect={() => selectMethod("nixpacks")}
          />
          <BuildMethodCard
            label="Static site"
            hint="Build un dossier statique puis sert l'output via Caddy, sans container runtime"
            active={form.buildMethod === "static"}
            detected={classification?.stack === "static"}
            onSelect={() => selectMethod("static")}
          />
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <ConfigField
          id="root-dir"
          label="Répertoire racine"
          placeholder="./"
          value={form.rootDir}
          onChange={(v) => setField("rootDir", v)}
        />
        <ConfigField
          id="dockerfile-path"
          label="Chemin du Dockerfile"
          placeholder="Dockerfile"
          value={form.dockerfilePath}
          onChange={(v) => setField("dockerfilePath", v)}
        />
      </div>

      {isStaticBuild && (
        <section className="space-y-3">
          <ConfigField
            id="static-output-dir"
            label="Output directory"
            placeholder="dist"
            value={form.staticOutputDir}
            onChange={(v) => setField("staticOutputDir", v)}
          />
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-background p-3 transition-colors hover:bg-muted/30">
            <input
              type="checkbox"
              checked={form.staticSpaFallback}
              onChange={(e) => setField("staticSpaFallback", e.target.checked)}
              className="mt-0.5 size-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">SPA fallback</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Sert <code className="font-mono">index.html</code> pour les routes
                client-side.
              </span>
            </span>
          </label>
        </section>
      )}

      <button
        type="button"
        onClick={onToggleAdvanced}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <RiArrowRightSLine
          className={cn(
            "size-3.5 transition-transform duration-150",
            showAdvanced && "rotate-90"
          )}
        />
        Options avancées
      </button>

      {showAdvanced && (
        <div className="space-y-3 rounded-lg border border-dashed border-border bg-muted/20 p-4 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <ConfigField
              id="install-cmd"
              label="Commande install"
              placeholder="npm install"
              value={form.installCommand}
              onChange={(v) => setField("installCommand", v)}
            />
            <ConfigField
              id="build-cmd"
              label="Commande build"
              placeholder="npm run build"
              value={form.buildCommand}
              onChange={(v) => setField("buildCommand", v)}
            />
            {!isStaticBuild && (
              <ConfigField
                id="start-cmd"
                label="Commande start"
                placeholder="node dist/index.js"
                value={form.startCommand}
                onChange={(v) => setField("startCommand", v)}
              />
            )}
            <ConfigField
              id="watch-paths"
              label="Watch paths (séparés par virgule)"
              placeholder="src/,package.json"
              value={form.watchPaths}
              onChange={(v) => setField("watchPaths", v)}
            />
          </div>

          {!isStaticBuild && (
            <div className="space-y-2 border-t border-border/60 pt-3">
              <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                Healthcheck
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <ConfigField
                  id="healthcheck-path"
                  label="Path"
                  placeholder="/health"
                  value={form.healthcheckPath}
                  onChange={(v) => setField("healthcheckPath", v)}
                />
                <div className="space-y-1">
                  <label
                    htmlFor="healthcheck-port"
                    className="block text-xs font-medium"
                  >
                    Port
                  </label>
                  <input
                    id="healthcheck-port"
                    type="number"
                    min={1}
                    max={65535}
                    placeholder="3000"
                    value={form.healthcheckPort}
                    onChange={(e) =>
                      setField("healthcheckPort", e.target.value)
                    }
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm focus:ring-2 focus:ring-ring focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 3 — Resources
// ---------------------------------------------------------------------------

function ResourcesStep({
  value,
  onChange,
}: {
  value: PlanSelectorValue
  onChange: (v: PlanSelectorValue) => void
}): React.JSX.Element {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <RiInformationLine className="mt-0.5 size-4 shrink-0 text-primary" />
        <p>
          Choisis un plan prédéfini ou bascule en « Custom » pour déclarer les
          limites CPU / mémoire / PIDs à la main. Les quotas peuvent être
          modifiés après création.
        </p>
      </div>
      <PlanSelector value={value} onChange={onChange} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function DetectedPanel({
  classification,
}: {
  classification: StackClassification
}): React.JSX.Element {
  const labelByConfidence: Record<StackClassification["confidence"], string> = {
    high: "Détecté",
    medium: "Probable",
    low: "Estimation",
  }
  return (
    <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-primary/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wide text-primary uppercase">
          {labelByConfidence[classification.confidence]}
        </span>
        <span className="text-sm font-medium">
          {classification.framework ?? classification.stack}
        </span>
      </div>
      {classification.signals.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {classification.signals.map((s) => (
            <span
              key={s}
              className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
            >
              {s}
            </span>
          ))}
        </div>
      )}
      {classification.warnings.length > 0 && (
        <ul className="space-y-0.5">
          {classification.warnings.map((w) => (
            <li
              key={w}
              className="text-[11px] text-amber-600 dark:text-amber-400"
            >
              ⚠ {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function LaravelRuntimePanel({
  seedOnFirstDeploy,
  onSeedOnFirstDeployChange,
}: {
  seedOnFirstDeploy: boolean
  onSeedOnFirstDeployChange: (value: boolean) => void
}): React.JSX.Element {
  return (
    <section className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Laravel runtime</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Pour les apps Laravel en SQLite, Ploydok prépare le fichier et lance
            les migrations au démarrage.
          </p>
        </div>
        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wide text-primary uppercase">
          SQLite
        </span>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-background p-3 transition-colors hover:bg-muted/30">
        <input
          type="checkbox"
          checked={seedOnFirstDeploy}
          onChange={(e) => onSeedOnFirstDeployChange(e.target.checked)}
          className="mt-0.5 size-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium">
            Seeder la base SQLite au premier déploiement
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Ajoute <code className="font-mono">PLOYDOK_LARAVEL_SEED=true</code>{" "}
            et lance <code className="font-mono">php artisan db:seed</code>{" "}
            seulement si le fichier SQLite vient d'être créé.
          </span>
        </span>
      </label>
    </section>
  )
}

function BuildMethodCard({
  label,
  hint,
  active,
  detected,
  onSelect,
}: {
  label: string
  hint: string
  active: boolean
  detected: boolean
  onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className={cn(
        "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-all",
        active
          ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20"
          : "border-border bg-card hover:border-primary/30 hover:bg-muted/40"
      )}
    >
      <div className="flex w-full items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        {detected && (
          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] font-medium tracking-wide text-primary uppercase">
            Détecté
          </span>
        )}
      </div>
      <span className="text-[11px] text-muted-foreground">{hint}</span>
    </button>
  )
}

function ChoiceCard({
  active,
  onSelect,
  label,
  hint,
}: {
  active: boolean
  onSelect: () => void
  label: string
  hint: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className={cn(
        "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-all",
        active
          ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20"
          : "border-border bg-card hover:border-primary/30 hover:bg-muted/40"
      )}
    >
      <span className="text-sm font-medium">{label}</span>
      <span className="text-[11px] text-muted-foreground">{hint}</span>
    </button>
  )
}

interface ConfigFieldProps {
  id: string
  label: string
  placeholder: string
  value: string
  onChange: (v: string) => void
}

function ConfigField({
  id,
  label,
  placeholder,
  value,
  onChange,
}: ConfigFieldProps): React.JSX.Element {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium">
        {label}
      </label>
      <input
        id={id}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-1.5 font-mono text-sm shadow-sm focus:ring-2 focus:ring-ring focus:outline-none"
      />
    </div>
  )
}

function DockerIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M22.41 9.78a5.6 5.6 0 0 0-1.49-.21 6.6 6.6 0 0 0-1.7.22 5.7 5.7 0 0 0-2.6-3.17l-.51-.3-.34.49a4.78 4.78 0 0 0-.78 1.83 4.5 4.5 0 0 0 .54 3.46 6.5 6.5 0 0 1-2.36.55H1.13l-.07.41a8.6 8.6 0 0 0 .87 5.18 5.5 5.5 0 0 0 5.51 2.93c4.61 0 8.05-2.13 9.66-6 1.07.05 3.42 0 4.62-2.32 0-.05.27-.6.34-.79l.18-.51-.83-.7zM2.6 11.93h2.13a.18.18 0 0 0 .19-.19V9.84a.19.19 0 0 0-.19-.19H2.6a.19.19 0 0 0-.19.19v1.9a.19.19 0 0 0 .19.19zm2.94 0h2.14a.19.19 0 0 0 .19-.19V9.84a.19.19 0 0 0-.19-.19H5.54a.19.19 0 0 0-.19.19v1.9a.19.19 0 0 0 .19.19zm3 0h2.13a.19.19 0 0 0 .19-.19V9.84a.19.19 0 0 0-.19-.19H8.5a.19.19 0 0 0-.19.19v1.9a.19.19 0 0 0 .19.19zm2.97 0h2.13a.19.19 0 0 0 .19-.19V9.84a.19.19 0 0 0-.19-.19h-2.13a.19.19 0 0 0-.19.19v1.9a.19.19 0 0 0 .19.19zM5.54 9.2h2.14a.19.19 0 0 0 .19-.19V7.1a.19.19 0 0 0-.19-.19H5.54a.19.19 0 0 0-.19.19v1.9a.19.19 0 0 0 .19.19zm3 0h2.13a.19.19 0 0 0 .19-.19V7.1a.19.19 0 0 0-.19-.19H8.5a.19.19 0 0 0-.19.19v1.9a.19.19 0 0 0 .19.19zm2.97 0h2.13a.19.19 0 0 0 .19-.19V7.1a.19.19 0 0 0-.19-.19h-2.13a.19.19 0 0 0-.19.19v1.9a.19.19 0 0 0 .19.19zm0-2.74h2.13a.19.19 0 0 0 .19-.19V4.36a.19.19 0 0 0-.19-.19h-2.13a.19.19 0 0 0-.19.19v1.91a.19.19 0 0 0 .19.19zm2.99 5.47h2.14a.19.19 0 0 0 .19-.19V9.84a.19.19 0 0 0-.19-.19h-2.14a.19.19 0 0 0-.19.19v1.9a.19.19 0 0 0 .19.19z" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Build POST /apps body from form state
// ---------------------------------------------------------------------------

function buildCreateAppBody(
  form: FormState,
  organizationId?: string
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: form.name.trim(),
    gitProvider: form.source,
  }

  if (organizationId) {
    body.organizationId = organizationId
  }

  if (form.source === "image") {
    body.imageRef = form.imageRef.trim()
    body.imagePullPolicy = form.imagePullPolicy
    if (form.registryCredentialId) {
      body.registryCredentialId = form.registryCredentialId
    }
  } else if (form.selectedRepo) {
    body.repoFullName = form.selectedRepo.fullName
    body.branch = form.branch

    if (form.source === "gitlab" && typeof form.selectedRepo.id === "number") {
      body.gitlabProjectId = form.selectedRepo.id
    }

    body.buildMethod = form.buildMethod
    if (form.rootDir) body.rootDir = form.rootDir
    if (form.dockerfilePath) body.dockerfilePath = form.dockerfilePath
    if (form.installCommand) body.installCommand = form.installCommand
    if (form.buildCommand) body.buildCommand = form.buildCommand
    if (form.startCommand) body.startCommand = form.startCommand
    if (form.buildMethod === "static") {
      body.staticOutputDir = form.staticOutputDir.trim() || "dist"
      body.staticSpaFallback = form.staticSpaFallback
    }

    const watchPaths = form.watchPaths
      ? form.watchPaths
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined
    if (watchPaths && watchPaths.length > 0) body.watchPaths = watchPaths

    const parsedPort =
      form.healthcheckPort.trim() !== ""
        ? Number.parseInt(form.healthcheckPort.trim(), 10)
        : undefined
    const validPort =
      parsedPort !== undefined &&
      Number.isFinite(parsedPort) &&
      parsedPort >= 1 &&
      parsedPort <= 65535
        ? parsedPort
        : undefined

    if (form.buildMethod !== "static" && form.healthcheckPath) {
      body.healthcheck = {
        path: form.healthcheckPath,
        port: validPort,
        intervalS: 5,
        timeoutS: 3,
        retries: 6,
        startPeriodS: 0,
      }
    }

    if (form.laravelSeedOnFirstDeploy) {
      body.initialSecrets = [
        {
          key: "PLOYDOK_LARAVEL_SEED",
          value: "true",
          scope: "shared",
          phase: "runtime",
        },
      ]
    }
  }

  body.plan = form.plan.plan
  if (form.plan.plan === "custom") {
    if (form.plan.cpuLimit !== undefined) body.cpuLimit = form.plan.cpuLimit
    if (form.plan.memLimitMB !== undefined)
      body.memLimitMB = form.plan.memLimitMB
    if (form.plan.pidsLimit !== undefined) body.pidsLimit = form.plan.pidsLimit
  }

  return body
}
