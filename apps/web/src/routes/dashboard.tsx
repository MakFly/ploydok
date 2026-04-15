// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "../components/layout/AppShell";
import { SecondFactorBanner } from "../components/auth/SecondFactorBanner";
import { apiFetch } from "../lib/api";
import type { Me } from "@ploydok/shared";

export const Route = createFileRoute("/dashboard")({
  beforeLoad: async (): Promise<{ me: Me }> => {
    try {
      const me = await apiFetch<Me>("/me");
      return { me };
    } catch {
      throw redirect({ to: "/login" });
    }
  },
  component: DashboardPage,
});

function DashboardPage(): React.JSX.Element {
  const { me } = Route.useRouteContext();

  return (
    <AppShell>
      <SecondFactorBanner me={me} />
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Welcome, {me.display_name}</h1>
        <p className="text-muted-foreground">
          Your Ploydok dashboard. Projects and apps will appear here.
        </p>
      </div>
    </AppShell>
  );
}
