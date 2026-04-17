// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react";
import { Button } from "@workspace/ui/components/button";
import { useCreateApp } from "../../lib/apps";
import { useGitHubBranches } from "../../lib/github";
import { RepoSelector } from "./RepoSelector";
import type { AppConfig, GitBranch, GitRepo } from "@ploydok/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CreateAppModalProps {
  open: boolean;
  onClose: () => void;
}

type Step = 1 | 2 | 3;

interface FormState {
  name: string;
  selectedRepo: GitRepo | null;
  branch: string;
  rootDir: string;
  dockerfilePath: string;
  installCommand: string;
  buildCommand: string;
  startCommand: string;
  watchPaths: string;
  healthcheckPath: string;
}

const INITIAL_FORM: FormState = {
  name: "",
  selectedRepo: null,
  branch: "",
  rootDir: "",
  dockerfilePath: "",
  installCommand: "",
  buildCommand: "",
  startCommand: "",
  watchPaths: "",
  healthcheckPath: "/",
};

// ---------------------------------------------------------------------------
// CreateAppModal
// ---------------------------------------------------------------------------

export function CreateAppModal({ open, onClose }: CreateAppModalProps): React.JSX.Element | null {
  const [step, setStep] = React.useState<Step>(1);
  const [form, setForm] = React.useState<FormState>(INITIAL_FORM);
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const createApp = useCreateApp();

  const { data: branches, isLoading: branchesLoading } = useGitHubBranches(
    form.selectedRepo?.fullName,
  );

  React.useEffect(() => {
    if (!open) {
      setStep(1);
      setForm(INITIAL_FORM);
      setShowAdvanced(false);
      setSubmitError(null);
    }
  }, [open]);

  React.useEffect(() => {
    if (branches && branches.length > 0 && !form.branch) {
      const repoDefault = form.selectedRepo?.defaultBranch;
      const defaultBranch = repoDefault !== undefined ? repoDefault : (branches[0]?.name ?? "");
      setForm((prev) => ({ ...prev, branch: defaultBranch }));
    }
  }, [branches, form.selectedRepo?.defaultBranch, form.branch]);

  if (!open) return null;

  const setField = <TKey extends keyof FormState>(key: TKey, value: FormState[TKey]): void => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleRepoSelect = (repo: GitRepo): void => {
    setForm((prev) => ({
      ...prev,
      selectedRepo: repo,
      branch: "",
      name: prev.name || (repo.fullName.split("/")[1] ?? ""),
    }));
  };

  const canGoNext = (): boolean => {
    if (step === 1) return form.name.trim().length > 0;
    if (step === 2) return form.selectedRepo !== null && form.branch.length > 0;
    return true;
  };

  const handleSubmit = async (): Promise<void> => {
    if (!form.selectedRepo) return;
    setSubmitError(null);
    try {
      const watchPaths = form.watchPaths
        ? form.watchPaths.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;

      await createApp.mutateAsync({
        name: form.name.trim(),
        gitProvider: "github",
        repoFullName: form.selectedRepo.fullName,
        branch: form.branch,
        rootDir: form.rootDir || undefined,
        dockerfilePath: form.dockerfilePath || undefined,
        installCommand: form.installCommand || undefined,
        buildCommand: form.buildCommand || undefined,
        startCommand: form.startCommand || undefined,
        watchPaths,
        healthcheck: form.healthcheckPath
          ? { path: form.healthcheckPath, intervalS: 5, timeoutS: 3, retries: 6, startPeriodS: 0 }
          : undefined,
      } satisfies Partial<AppConfig>);
      onClose();
      // Navigate to app detail once M3.4 creates the /apps/$id route.
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to create app");
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-app-title"
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-background shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 id="create-app-title" className="text-base font-semibold">
              New App
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">Step {step} of 3</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="Close dialog"
          >
            <CloseIcon className="size-4" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex border-b border-border">
          {([1, 2, 3] as const).map((s) => (
            <div
              key={s}
              className={[
                "flex-1 py-2 text-center text-xs font-medium transition-colors",
                s === step ? "text-foreground border-b-2 border-primary" :
                s < step ? "text-muted-foreground" : "text-muted-foreground/50",
              ].join(" ")}
            >
              {s === 1 ? "Name" : s === 2 ? "Repository" : "Config"}
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
          {step === 1 && (
            <Step1 name={form.name} onNameChange={(v) => setField("name", v)} />
          )}
          {step === 2 && (
            <Step2
              selectedRepo={form.selectedRepo}
              onRepoSelect={handleRepoSelect}
              branch={form.branch}
              onBranchChange={(v) => setField("branch", v)}
              branches={branches ?? []}
              branchesLoading={branchesLoading}
            />
          )}
          {step === 3 && (
            <Step3
              form={form}
              setField={setField}
              showAdvanced={showAdvanced}
              onToggleAdvanced={() => setShowAdvanced((v) => !v)}
            />
          )}

          {submitError && (
            <p className="text-sm text-destructive" role="alert">{submitError}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-6 py-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={step === 1 ? onClose : () => setStep((s) => (s - 1) as Step)}
          >
            {step === 1 ? "Cancel" : "Back"}
          </Button>
          <div className="flex gap-2">
            {step < 3 ? (
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
// Step 1 — Name
// ---------------------------------------------------------------------------

interface Step1Props {
  name: string;
  onNameChange: (v: string) => void;
}

function Step1({ name, onNameChange }: Step1Props): React.JSX.Element {
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
// Step 2 — Repository
// ---------------------------------------------------------------------------

interface Step2Props {
  selectedRepo: GitRepo | null;
  onRepoSelect: (repo: GitRepo) => void;
  branch: string;
  onBranchChange: (v: string) => void;
  branches: Array<GitBranch>;
  branchesLoading: boolean;
}

function Step2({
  selectedRepo,
  onRepoSelect,
  branch,
  onBranchChange,
  branches,
  branchesLoading,
}: Step2Props): React.JSX.Element {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium mb-2">Select repository</p>
        <RepoSelector selected={selectedRepo} onSelect={onRepoSelect} />
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

// ---------------------------------------------------------------------------
// Step 3 — Config
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

      {/* Advanced toggle */}
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

          {/* Healthcheck accordion */}
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
          </div>
        </div>
      )}
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
