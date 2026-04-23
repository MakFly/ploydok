// SPDX-License-Identifier: AGPL-3.0-only
import { Outlet, createFileRoute } from "@tanstack/react-router";
import { AppShell } from "../components/layout/AppShell";
import { SecondFactorBanner } from "../components/auth/SecondFactorBanner";
import { EventsProvider } from "../lib/events-provider";
import { requireMe } from "../lib/auth-guards";
import type { Me } from "@ploydok/shared";

// Legacy path redirects (/dashboard, /apps/**, /databases/**) are handled by
// dedicated splat/stub routes — see _authed/dashboard.tsx, _authed/apps.$.tsx
// and _authed/databases.$.tsx. This layout just runs the shared auth guard.
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
