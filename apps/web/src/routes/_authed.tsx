// SPDX-License-Identifier: AGPL-3.0-only
import { Outlet, createFileRoute } from "@tanstack/react-router";
import type { Me } from "@ploydok/shared";
import { AppShell } from "../components/layout/AppShell";
import { requireMe } from "../lib/auth-guards";

export const Route = createFileRoute("/_authed")({
  beforeLoad: async (): Promise<{ me: Me }> => ({ me: await requireMe() }),
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
