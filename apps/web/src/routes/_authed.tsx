// SPDX-License-Identifier: AGPL-3.0-only
import { Outlet, createFileRoute } from "@tanstack/react-router";
import { AppShell } from "../components/layout/AppShell";
import { SecondFactorBanner } from "../components/auth/SecondFactorBanner";
import { EventsProvider } from "../lib/events-provider";
import { requireMe } from "../lib/auth-guards";
import type { Me } from "@ploydok/shared";

export const Route = createFileRoute("/_authed")({
  beforeLoad: async (): Promise<{ me: Me }> => ({ me: await requireMe() }),
  component: () => (
    <EventsProvider>
      <AppShell banner={<SecondFactorBanner />}>
        <Outlet />
      </AppShell>
    </EventsProvider>
  ),
});
