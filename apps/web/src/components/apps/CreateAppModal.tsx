// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react";
import { Button } from "@workspace/ui/components/button";
import { useCreateApp } from "../../lib/apps";
import { useGitHubBranches } from "../../lib/github";
import { useGitLabBranches } from "../../lib/gitlab";
import { useRegistryCredentials } from "../../lib/registry-credentials";
import { RepoSelector } from "./RepoSelector";
import { GitLabRepoSelector } from "./GitLabRepoSelector";
import { PlanSelector, type PlanSelectorValue } from "./PlanSelector";
import type { AppConfig, GitBranch, GitRepo } from "@ploydok/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CreateAppModalProps {
  open: boolean;
  organizationId?: string;
  onClose: () => void;
}

type SourceKind = "github" | "gitlab" | "image";
type Step = 1 | 2 | 3 | 4;

interface FormState {
  name: string;
  source: SourceKind;
  // git-based (github, gitlab)
  selectedRepo: GitRepo | null;
  branch: string;
  // image-based
  imageRef: string;
  imagePullPolicy: "always" | "if_not_present";
  registryCredentialId: string;
  // git build overrides (step 3)
  rootDir: string;
  dockerfilePath: string;
  installCommand: string;
  buildCommand: string;
  startCommand: string;
  watchPaths: string;
  healthcheckPath: string;
  healthcheckPort: string;
  // quotas (step 4)
  plan: PlanSelectorValue;
}

const INITIAL_FORM: FormState = {
  name: "",
  source: "github",
  selectedRepo: null,
  branch: "",
  imageRef: "",
  imagePullPolicy: "always",
  registryCredentialId: "",
  rootDir: "",
  dockerfilePath: "",
  installCommand: "",
  buildCommand: "",
  startCommand: "",
  watchPaths: "",
  healthcheckPath: "/",
  healthcheckPort: "",
  plan: { plan: "small" },
};

// ---------------------------------------------------------------------------
// CreateAppModal
// ---------------------------------------------------------------------------

export function CreateAppModal({ open, organizationId, onClose }: CreateAppModalProps): React.JSX.Element | null {
  const [step, setStep] = React.useState<Step>(1);
  const [form, setForm] = React.useState<FormState>(INITIAL_FORM);
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const createApp = useCreateApp();

  const { data: ghBranches, isLoading: ghBranchesLoading } = useGitHubBranches(
    form.source === "github" ? form.selectedRepo?.fullName : undefined,
  );
  const { data: glBranches, isLoading: glBranchesLoading } = useGitLabBranches(
    form.source === "gitlab" ? form.selectedRepo?.fullName : undefined,
  );

  const branches: Array<GitBranch> =
    form.source === "github" ? (ghBranches ?? []) : form.source === "gitlab" ? (glBranches ?? []) : [];
  const branchesLoading =
    form.source === "github" ? ghBranchesLoading : form.source === "gitlab" ? glBranchesLoading : false;

  React.useEffect(() => {
    if (!open) {
      setStep(1);
      setForm(INITIAL_FORM);
      setShowAdvanced(false);
      setSubmitError(null);
    }
  }, [open]);

  React.useEffect(() => {
    if (branches.length > 0 && !form.branch) {
      const repoDefault = form.selectedRepo?.defaultBranch;
      const defaultBranch = repoDefault !== undefined ? repoDefault : (branches[0]?.name ?? "");
      setForm((prev) => ({ ...prev, branch: defaultBranch }));
    }
  }, [branches, form.selectedRepo?.defaultBranch, form.branch]);

  if (!open) return null;

  const setField = <TKey extends keyof FormState>(key: TKey, value: FormState[TKey]): void => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSourceChange = (source: SourceKind): void => {
    setForm((prev) => ({
      ...prev,
      source,
      selectedRepo: null,
      branch: "",
    }));
  };

  const handleRepoSelect = (repo: GitRepo): void => {
    setForm((prev) => ({
      ...prev,
      selectedRepo: repo,
      branch: "",
      name: prev.name || (repo.fullName.split("/").at(-1) ?? ""),
    }));
  };

  const totalSteps: number = form.source === "image" ? 3 : 4;

  const canGoNext = (): boolean => {
    if (step === 1) return form.name.trim().length > 0;
    if (step === 2 && form.source === "image") {
      return form.imageRef.trim().length > 0;
    }
    if (step === 2) {
      return form.selectedRepo !== null && form.branch.length > 0;
    }
    return true;
  };

  const handleSubmit = async (): Promise<void> => {
    setSubmitError(null);
    try {
      const body = buildCreateAppBody(form, organizationId);
      await createApp.mutateAsync(body as Partial<AppConfig>);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to create app");
    }
  };

  const stepLabels = form.source === "image"
    ? ["Name", "Image", "Quotas"]
    : ["Name", "Repository", "Config", "Quotas"];

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
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-background shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 id="create-app-title" className="text-base font-semibold">
              New App
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Step {step} of {totalSteps}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="Close dialog"
          >
            <CloseIcon className="size-4" />
          </button>
        </div>

        <div className="flex border-b border-border">
          {stepLabels.map((label, idx) => {
            const s = (idx + 1) as Step;
            return (
              <div
                key={label}
                className={[
                  "flex-1 py-2 text-center text-xs font-medium transition-colors",
                  s === step
                    ? "text-foreground border-b-2 border-primary"
                    : s < step
                      ? "text-muted-foreground"
                      : "text-muted-foreground/50",
                ].join(" ")}
              >
                {label}
              </div>
            );
          })}
        </div>

        <div className="p-6 space-y-4 max-h-[65vh] overflow-y-auto">
          {step === 1 && (
            <Step1 name={form.name} onNameChange={(v) => setField("name", v)} />
          )}
          {step === 2 && (
            <Step2
              source={form.source}
              onSourceChange={handleSourceChange}
              selectedRepo={form.selectedRepo}
              onRepoSelect={handleRepoSelect}
              branch={form.branch}
              onBranchChange={(v) => setField("branch", v)}
              branches={branches}
              branchesLoading={branchesLoading}
              imageRef={form.imageRef}
              onImageRefChange={(v) => setField("imageRef", v)}
              imagePullPolicy={form.imagePullPolicy}
              onImagePullPolicyChange={(v) => setField("imagePullPolicy", v)}
              registryCredentialId={form.registryCredentialId}
              onRegistryCredentialIdChange={(v) => setField("registryCredentialId", v)}
            />
          )}
          {step === 3 && form.source !== "image" && (
            <Step3
              form={form}
              setField={setField}
              showAdvanced={showAdvanced}
              onToggleAdvanced={() => setShowAdvanced((v) => !v)}
            />
          )}
          {step === 3 && form.source === "image" && (
            <QuotasStep
              value={form.plan}
              onChange={(v) => setField("plan", v)}
            />
          )}
          {step === 4 && (
            <QuotasStep
              value={form.plan}
              onChange={(v) => setField("plan", v)}
            />
          )}

          {submitError && (
            <p className="text-sm text-destructive" role="alert">{submitError}</p>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border px-6 py-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={step === 1 ? onClose : () => setStep((s) => (s - 1) as Step)}
          >
            {step === 1 ? "Cancel" : "Back"}
          </Button>
          <div className="flex gap-2">
            {step < totalSteps ? (
              <Button
                size="sm"
                onClick={() => setStep((s) => (s + 1) as Step)}
                disabled={!canGoNext()}
              >
                Next
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => void handleSubmit()}
                disabled={createApp.isPending || !canGoNext()}
              >
                {createApp.isPending ? "Creating..." : "Create app"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Build POST /apps body from form state
// ---------------------------------------------------------------------------

function buildCreateAppBody(form: FormState, organizationId?: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: form.name.trim(),
    gitProvider: form.source,
  };

  if (organizationId) {
    body.organizationId = organizationId;
  }

  if (form.source === "image") {
    body.imageRef = form.imageRef.trim();
    body.imagePullPolicy = form.imagePullPolicy;
    if (form.registryCredentialId) {
      body.registryCredentialId = form.registryCredentialId;
    }
  } else if (form.selectedRepo) {
    body.repoFullName = form.selectedRepo.fullName;
    body.branch = form.branch;

    if (form.source === "gitlab" && typeof form.selectedRepo.id === "number") {
      body.gitlabProjectId = form.selectedRepo.id;
    }

    if (form.rootDir) body.rootDir = form.rootDir;
    if (form.dockerfilePath) body.dockerfilePath = form.dockerfilePath;
    if (form.installCommand) body.installCommand = form.installCommand;
    if (form.buildCommand) body.buildCommand = form.buildCommand;
    if (form.startCommand) body.startCommand = form.startCommand;

    const watchPaths = form.watchPaths
      ? form.watchPaths.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
    if (watchPaths && watchPaths.length > 0) body.watchPaths = watchPaths;

    const parsedPort = form.healthcheckPort.trim() !== ""
      ? Number.parseInt(form.healthcheckPort.trim(), 10)
      : undefined;
    const validPort =
      parsedPort !== undefined &&
      Number.isFinite(parsedPort) &&
      parsedPort >= 1 &&
      parsedPort <= 65535
        ? parsedPort
        : undefined;

    if (form.healthcheckPath) {
      body.healthcheck = {
        path: form.healthcheckPath,
        port: validPort,
        intervalS: 5,
        timeoutS: 3,
        retries: 6,
        startPeriodS: 0,
      };
    }
  }

  // Quotas (all sources)
  body.plan = form.plan.plan;
  if (form.plan.plan === "custom") {
    if (form.plan.cpuLimit !== undefined) body.cpuLimit = form.plan.cpuLimit;
    if (form.plan.memLimitMB !== undefined) body.memLimitMB = form.plan.memLimitMB;
    if (form.plan.pidsLimit !== undefined) body.pidsLimit = form.plan.pidsLimit;
  }

  return body;
}

// ---------------------------------------------------------------------------
// Step 1 — Name
// ---------------------------------------------------------------------------

function Step1({ name, onNameChange }: { name: string; onNameChange: (v: string) => void }): React.JSX.Element {
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="app-name" className="text-sm font-medium block mb-1.5">
          App name
        </label>
        <input
          id="app-name"
          type="text"
          placeholder="my-app"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          autoFocus
        />
        <p className="mt-1.5 text-xs text-muted-foreground">
          Used to identify your app. Must be unique within your account.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Source picker (github / gitlab / image)
// ---------------------------------------------------------------------------

interface Step2Props {
  source: SourceKind;
  onSourceChange: (s: SourceKind) => void;
  selectedRepo: GitRepo | null;
  onRepoSelect: (repo: GitRepo) => void;
  branch: string;
  onBranchChange: (v: string) => void;
  branches: Array<GitBranch>;
  branchesLoading: boolean;
  imageRef: string;
  onImageRefChange: (v: string) => void;
  imagePullPolicy: "always" | "if_not_present";
  onImagePullPolicyChange: (v: "always" | "if_not_present") => void;
  registryCredentialId: string;
  onRegistryCredentialIdChange: (v: string) => void;
}

function Step2(props: Step2Props): React.JSX.Element {
  return (
    <div className="space-y-4">
      <SourceTabs source={props.source} onChange={props.onSourceChange} />

      {props.source === "github" && (
        <GitSource
          providerLabel="GitHub"
          branches={props.branches}
          branchesLoading={props.branchesLoading}
          selectedRepo={props.selectedRepo}
          onRepoSelect={props.onRepoSelect}
          branch={props.branch}
          onBranchChange={props.onBranchChange}
        >
          <RepoSelector selected={props.selectedRepo} onSelect={props.onRepoSelect} />
        </GitSource>
      )}

      {props.source === "gitlab" && (
        <GitSource
          providerLabel="GitLab"
          branches={props.branches}
          branchesLoading={props.branchesLoading}
          selectedRepo={props.selectedRepo}
          onRepoSelect={props.onRepoSelect}
          branch={props.branch}
          onBranchChange={props.onBranchChange}
        >
          <GitLabRepoSelector selected={props.selectedRepo} onSelect={props.onRepoSelect} />
        </GitSource>
      )}

      {props.source === "image" && (
        <ImageSource
          imageRef={props.imageRef}
          onImageRefChange={props.onImageRefChange}
          imagePullPolicy={props.imagePullPolicy}
          onImagePullPolicyChange={props.onImagePullPolicyChange}
          registryCredentialId={props.registryCredentialId}
          onRegistryCredentialIdChange={props.onRegistryCredentialIdChange}
        />
      )}
    </div>
  );
}

function SourceTabs({
  source,
  onChange,
}: {
  source: SourceKind;
  onChange: (s: SourceKind) => void;
}): React.JSX.Element {
  const tabs: Array<{ id: SourceKind; label: string; hint: string }> = [
    { id: "github", label: "GitHub", hint: "Repo + auto-deploy sur push" },
    { id: "gitlab", label: "GitLab", hint: "Repo + auto-deploy sur push" },
    { id: "image", label: "Image", hint: "Docker OCI image" },
  ];

  return (
    <div role="tablist" aria-label="Source" className="grid gap-2 sm:grid-cols-3">
      {tabs.map((t) => {
        const active = source === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={[
              "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
              active
                ? "border-primary/50 bg-primary/5"
                : "border-border bg-card hover:border-primary/30",
            ].join(" ")}
          >
            <span className="text-sm font-medium">{t.label}</span>
            <span className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
              {t.hint}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function GitSource({
  providerLabel,
  branches,
  branchesLoading,
  selectedRepo,
  branch,
  onBranchChange,
  children,
}: {
  providerLabel: string;
  branches: Array<GitBranch>;
  branchesLoading: boolean;
  selectedRepo: GitRepo | null;
  onRepoSelect: (repo: GitRepo) => void;
  branch: string;
  onBranchChange: (v: string) => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium mb-2">Select {providerLabel} repository</p>
        {children}
      </div>

      {selectedRepo && (
        <div>
          <label htmlFor="branch-select" className="text-sm font-medium block mb-1.5">
            Branch
          </label>
          {branchesLoading ? (
            <div className="h-9 w-full rounded-md bg-muted animate-pulse" />
          ) : (
            <select
              id="branch-select"
              value={branch}
              onChange={(e) => onBranchChange(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Select a branch...</option>
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
  );
}

interface ImageSourceProps {
  imageRef: string;
  onImageRefChange: (v: string) => void;
  imagePullPolicy: "always" | "if_not_present";
  onImagePullPolicyChange: (v: "always" | "if_not_present") => void;
  registryCredentialId: string;
  onRegistryCredentialIdChange: (v: string) => void;
}

function ImageSource({
  imageRef,
  onImageRefChange,
  imagePullPolicy,
  onImagePullPolicyChange,
  registryCredentialId,
  onRegistryCredentialIdChange,
}: ImageSourceProps): React.JSX.Element {
  const { data: credentials, isLoading } = useRegistryCredentials();

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="image-ref" className="text-sm font-medium block mb-1.5">
          Image reference
        </label>
        <input
          id="image-ref"
          type="text"
          placeholder="nginx:alpine"
          value={imageRef}
          onChange={(e) => onImageRefChange(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          autoFocus
        />
        <p className="mt-1.5 text-xs text-muted-foreground">
          Examples : <code className="font-mono text-[11px]">nginx:alpine</code>,{" "}
          <code className="font-mono text-[11px]">ghcr.io/org/app:v1</code>.
        </p>
      </div>

      <div>
        <label htmlFor="registry-cred" className="text-sm font-medium block mb-1.5">
          Registry credential
        </label>
        <select
          id="registry-cred"
          value={registryCredentialId}
          onChange={(e) => onRegistryCredentialIdChange(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Public / anonymous</option>
          {isLoading ? (
            <option disabled>Loading…</option>
          ) : (
            (credentials ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} ({c.registryHost})
              </option>
            ))
          )}
        </select>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Gérer les credentials dans{" "}
          <a className="underline underline-offset-2" href="/settings/registry">
            Settings — Registry
          </a>
          .
        </p>
      </div>

      <fieldset>
        <legend className="text-sm font-medium mb-1.5">Pull policy</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <PullPolicyOption
            value="always"
            active={imagePullPolicy === "always"}
            onSelect={() => onImagePullPolicyChange("always")}
            label="Always"
            hint="Pull avant chaque deploy"
          />
          <PullPolicyOption
            value="if_not_present"
            active={imagePullPolicy === "if_not_present"}
            onSelect={() => onImagePullPolicyChange("if_not_present")}
            label="If not present"
            hint="Pull seulement si absent localement"
          />
        </div>
      </fieldset>
    </div>
  );
}

function PullPolicyOption({
  value,
  active,
  onSelect,
  label,
  hint,
}: {
  value: string;
  active: boolean;
  onSelect: () => void;
  label: string;
  hint: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      data-value={value}
      onClick={onSelect}
      className={[
        "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
        active
          ? "border-primary/50 bg-primary/5"
          : "border-border bg-card hover:border-primary/30",
      ].join(" ")}
    >
      <span className="text-sm font-medium">{label}</span>
      <span className="text-[11px] text-muted-foreground">{hint}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Git config (root dir / dockerfile / advanced)
// ---------------------------------------------------------------------------

interface Step3Props {
  form: FormState;
  setField: <TKey extends keyof FormState>(key: TKey, value: FormState[TKey]) => void;
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
}

function Step3({ form, setField, showAdvanced, onToggleAdvanced }: Step3Props): React.JSX.Element {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        All fields are optional. Leave blank to use auto-detection.
      </p>

      <ConfigField
        id="root-dir"
        label="Root directory"
        placeholder="./"
        value={form.rootDir}
        onChange={(v) => setField("rootDir", v)}
      />
      <ConfigField
        id="dockerfile-path"
        label="Dockerfile path"
        placeholder="Dockerfile"
        value={form.dockerfilePath}
        onChange={(v) => setField("dockerfilePath", v)}
      />

      <button
        type="button"
        onClick={onToggleAdvanced}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronIcon
          className={["size-3 transition-transform", showAdvanced ? "rotate-90" : ""].join(" ")}
        />
        Advanced options
      </button>

      {showAdvanced && (
        <div className="space-y-3 border-l-2 border-border pl-4">
          <ConfigField
            id="install-cmd"
            label="Install command"
            placeholder="npm install"
            value={form.installCommand}
            onChange={(v) => setField("installCommand", v)}
          />
          <ConfigField
            id="build-cmd"
            label="Build command"
            placeholder="npm run build"
            value={form.buildCommand}
            onChange={(v) => setField("buildCommand", v)}
          />
          <ConfigField
            id="start-cmd"
            label="Start command"
            placeholder="node dist/index.js"
            value={form.startCommand}
            onChange={(v) => setField("startCommand", v)}
          />
          <ConfigField
            id="watch-paths"
            label="Watch paths (comma-separated)"
            placeholder="src/,package.json"
            value={form.watchPaths}
            onChange={(v) => setField("watchPaths", v)}
          />

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Healthcheck
            </p>
            <ConfigField
              id="healthcheck-path"
              label="Path"
              placeholder="/health"
              value={form.healthcheckPath}
              onChange={(v) => setField("healthcheckPath", v)}
            />
            <div>
              <label htmlFor="healthcheck-port" className="text-xs font-medium block mb-1">
                Port
              </label>
              <input
                id="healthcheck-port"
                type="number"
                min={1}
                max={65535}
                placeholder="3000"
                value={form.healthcheckPort}
                onChange={(e) => setField("healthcheckPort", e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quotas step
// ---------------------------------------------------------------------------

function QuotasStep({
  value,
  onChange,
}: {
  value: PlanSelectorValue;
  onChange: (v: PlanSelectorValue) => void;
}): React.JSX.Element {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Choisis un plan prédéfini ou bascule en « Custom » pour déclarer les
        limites CPU / mémoire / PIDs à la main.
      </p>
      <PlanSelector value={value} onChange={onChange} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ConfigFieldProps {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}

function ConfigField({ id, label, placeholder, value, onChange }: ConfigFieldProps): React.JSX.Element {
  return (
    <div>
      <label htmlFor={id} className="text-xs font-medium block mb-1">
        {label}
      </label>
      <input
        id={id}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </div>
  );
}

function CloseIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
