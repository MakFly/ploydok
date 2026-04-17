// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { useApp } from "../../../../lib/apps";
import type { AppSettingsPatch } from "../../../../lib/apps";
import { useUpdateAppSettings } from "../../../../lib/apps-mutations";

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/_authed/apps/$id/settings")({
  component: AppSettingsTab,
});

// ---------------------------------------------------------------------------
// Field list
// ---------------------------------------------------------------------------

type StringPatchKey = Exclude<keyof AppSettingsPatch, "healthcheckPort">;

interface FieldDef {
  key: StringPatchKey;
  label: string;
  placeholder: string;
  mono?: boolean;
}

const FIELDS: Array<FieldDef> = [
  { key: "branch", label: "Branch", placeholder: "main" },
  { key: "rootDir", label: "Root directory", placeholder: "/", mono: true },
  {
    key: "dockerfilePath",
    label: "Dockerfile path",
    placeholder: "Dockerfile",
    mono: true,
  },
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
    key: "buildMethod",
    label: "Build method",
    placeholder: "auto | docker | nixpacks",
    mono: true,
  },
  {
    key: "healthcheckPath",
    label: "Healthcheck path",
    placeholder: "/",
    mono: true,
  },
];

// ---------------------------------------------------------------------------
// AppSettingsTab
// ---------------------------------------------------------------------------

function AppSettingsTab(): React.JSX.Element {
  const { id } = Route.useParams();
  const { data: app, isLoading, error } = useApp(id);
  const update = useUpdateAppSettings(id);

  const [editing, setEditing] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [formData, setFormData] = React.useState<AppSettingsPatch>({});

  // Sync form when app data loads / changes
  React.useEffect(() => {
    if (app) {
      setFormData({
        branch: app.branch,
        rootDir: app.rootDir,
        dockerfilePath: app.dockerfilePath,
        installCommand: app.installCommand,
        buildCommand: app.buildCommand,
        startCommand: app.startCommand,
        buildMethod: app.buildMethod,
        healthcheckPath: app.healthcheckPath,
        healthcheckPort: app.healthcheckPort,
      });
    }
  }, [app]);

  if (isLoading) return <SettingsSkeleton />;
  if (error || !app) {
    return (
      <p className="text-sm text-destructive" role="alert">
        Failed to load settings: {error?.message ?? "Not found"}
      </p>
    );
  }

  const handleCancel = (): void => {
    setEditing(false);
    setFormError(null);
    setFormData({
      branch: app.branch,
      rootDir: app.rootDir,
      dockerfilePath: app.dockerfilePath,
      installCommand: app.installCommand,
      buildCommand: app.buildCommand,
      startCommand: app.startCommand,
      buildMethod: app.buildMethod,
      healthcheckPath: app.healthcheckPath,
      healthcheckPort: app.healthcheckPort,
    });
  };

  const handleSave = async (): Promise<void> => {
    setFormError(null);
    try {
      await update.mutateAsync(formData);
      setEditing(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Save failed");
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium">Build &amp; Deploy settings</h2>
          <p className="text-xs text-muted-foreground">
            Configure how this app is built and started.
          </p>
        </div>
        {!editing && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
      </div>

      <div className="rounded-lg border border-border divide-y divide-border/60">
        {FIELDS.map((field) => (
          <SettingsRow
            key={field.key}
            field={field}
            value={formData[field.key] ?? ""}
            editing={editing}
            onChange={(val) =>
              setFormData((prev) => ({ ...prev, [field.key]: val || undefined }))
            }
          />
        ))}
        <HealthcheckPortRow
          value={formData.healthcheckPort ?? null}
          editing={editing}
          onChange={(val) => setFormData((prev) => ({ ...prev, healthcheckPort: val }))}
        />
      </div>

      {formError && (
        <p className="text-sm text-destructive" role="alert">
          {formError}
        </p>
      )}

      {editing && (
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => void handleSave()}
            disabled={update.isPending}
          >
            {update.isPending ? "Saving…" : "Save changes"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleCancel}
            disabled={update.isPending}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// HealthcheckPortRow
// ---------------------------------------------------------------------------

interface HealthcheckPortRowProps {
  value: number | null;
  editing: boolean;
  onChange: (val: number | null) => void;
}

function HealthcheckPortRow({
  value,
  editing,
  onChange,
}: HealthcheckPortRowProps): React.JSX.Element {
  const displayValue = value != null ? String(value) : "";

  const handleChange = (raw: string): void => {
    if (raw.trim() === "") {
      onChange(null);
      return;
    }
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 65535) {
      onChange(parsed);
    }
  };

  return (
    <div className="grid grid-cols-[1fr_2fr] gap-4 px-4 py-3 items-center">
      <label
        htmlFor="setting-healthcheckPort"
        className="text-xs font-medium text-muted-foreground"
      >
        Healthcheck port
      </label>
      {editing ? (
        <input
          id="setting-healthcheckPort"
          type="number"
          min={1}
          max={65535}
          value={displayValue}
          placeholder="3000"
          onChange={(e) => handleChange(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono outline-none focus:ring-1 focus:ring-primary"
        />
      ) : (
        <p
          className={[
            "text-sm font-mono truncate",
            displayValue ? "" : "text-muted-foreground/60 italic",
          ].join(" ")}
        >
          {displayValue || "3000"}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SettingsRow
// ---------------------------------------------------------------------------

interface SettingsRowProps {
  field: FieldDef;
  value: string;
  editing: boolean;
  onChange: (val: string) => void;
}

function SettingsRow({
  field,
  value,
  editing,
  onChange,
}: SettingsRowProps): React.JSX.Element {
  return (
    <div className="grid grid-cols-[1fr_2fr] gap-4 px-4 py-3 items-center">
      <label
        htmlFor={`setting-${field.key}`}
        className="text-xs font-medium text-muted-foreground"
      >
        {field.label}
      </label>
      {editing ? (
        <input
          id={`setting-${field.key}`}
          type="text"
          value={value}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={[
            "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary",
            field.mono ? "font-mono" : "",
          ].join(" ")}
        />
      ) : (
        <p
          className={[
            "text-sm truncate",
            field.mono ? "font-mono" : "",
            value ? "" : "text-muted-foreground/60 italic",
          ].join(" ")}
        >
          {value || field.placeholder}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function SettingsSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-4 max-w-2xl animate-pulse">
      <div className="h-5 w-40 rounded bg-muted" />
      <div className="rounded-lg border border-border divide-y divide-border/60">
        {[...Array<null>(6)].map((_, i) => (
          <div key={i} className="grid grid-cols-[1fr_2fr] gap-4 px-4 py-3">
            <div className="h-4 w-24 rounded bg-muted" />
            <div className="h-4 w-40 rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
