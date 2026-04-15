// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react";
import { Link, Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "../../components/layout/AppShell";
import { apiFetch } from "../../lib/api";
import type { Me } from "@ploydok/shared";

export const Route = createFileRoute("/settings/security")({
  beforeLoad: async (): Promise<{ me: Me }> => {
    try {
      const me = await apiFetch<Me>("/me");
      return { me };
    } catch {
      throw redirect({ to: "/login" });
    }
  },
  component: SecurityLayout,
});

function SecurityLayout(): React.JSX.Element {
  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Security Settings</h1>
          <p className="text-sm text-muted-foreground">Manage your passkeys and active sessions.</p>
        </div>

        {/* Sub-nav */}
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
    </AppShell>
  );
}
