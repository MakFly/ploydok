// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/_authed/apps/$id/domains")({
  component: AppDomainsTab,
});

// ---------------------------------------------------------------------------
// AppDomainsTab — placeholder, out of scope for Sprint 3
// ---------------------------------------------------------------------------

function AppDomainsTab(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 py-20 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <DomainsIcon className="size-8 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium mb-1">Custom domains</p>
      <p className="text-sm text-muted-foreground">
        Coming soon — this feature is planned for a future sprint.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icon
// ---------------------------------------------------------------------------

function DomainsIcon({ className }: { className?: string }): React.JSX.Element {
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
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </svg>
  );
}
