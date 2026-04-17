// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react";
import { Link, Outlet, createFileRoute } from "@tanstack/react-router";
import { ShellPage } from "../../../components/layout/AppShell";

export const Route = createFileRoute("/_authed/settings/security")({
  component: SecurityLayout,
});

function SecurityLayout(): React.JSX.Element {
  return (
    <ShellPage
      title="Team"
      description="Account security and session controls, presented inside the shared Efferd-inspired authenticated shell."
      eyebrow="Settings"
    >
      <div className="space-y-6">
        {/* Top-level settings tabs */}
        <nav className="flex gap-1 border-b border-border pb-0" aria-label="Settings sections">
          <Link
            to="/settings/security"
            className="rounded-t-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground [&.active]:border-b-2 [&.active]:border-primary [&.active]:text-foreground"
          >
            Security
          </Link>
          <Link
            to="/settings/github"
            className="rounded-t-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground [&.active]:border-b-2 [&.active]:border-primary [&.active]:text-foreground"
          >
            GitHub
          </Link>
        </nav>

        {/* Security sub-nav */}
        <nav className="flex gap-1 border-b border-border pb-0" aria-label="Security sections">
          <Link
            to="/settings/security/passkeys"
            className="rounded-t-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground [&.active]:border-b-2 [&.active]:border-primary [&.active]:text-foreground"
          >
            Passkeys
          </Link>
          <Link
            to="/settings/security/sessions"
            className="rounded-t-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground [&.active]:border-b-2 [&.active]:border-primary [&.active]:text-foreground"
          >
            Sessions
          </Link>
        </nav>

        <Outlet />
      </div>
    </ShellPage>
  );
}
