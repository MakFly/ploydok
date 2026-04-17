// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/_authed/apps/$id/env")({
  component: AppEnvTab,
});

// ---------------------------------------------------------------------------
// AppEnvTab — placeholder, out of scope for Sprint 3
// ---------------------------------------------------------------------------

function AppEnvTab(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 py-20 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <EnvIcon className="size-8 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium mb-1">Environment variables</p>
      <p className="text-sm text-muted-foreground">
        Coming soon — this feature is planned for a future sprint.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icon
// ---------------------------------------------------------------------------

function EnvIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 7V4h16v3" />
      <path d="M9 20h6" />
      <path d="M12 4v16" />
    </svg>
  );
}
