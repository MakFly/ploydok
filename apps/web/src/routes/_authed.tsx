// SPDX-License-Identifier: AGPL-3.0-only
import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "../components/layout/AppShell";
import { SecondFactorBanner } from "../components/auth/SecondFactorBanner";
import { EventsProvider } from "../lib/events-provider";
import { requireMe } from "../lib/auth-guards";
import type { Me } from "@ploydok/shared";

// The app exposes two URL schemes for the same UI: legacy root routes
// (/dashboard, /apps/*, /databases/*) and org-scoped routes
// (/orgs/$slug/dashboard, /orgs/$slug/apps/*, ...). The org-scoped tree is the
// canonical one going forward. This layout redirects legacy paths to their
// org-scoped equivalent using the signed-in user's default organization slug,
// so that bookmarks stay working while the router has a single source of
// truth for "where am I" in the UI.
function canonicalizeLegacyPath(pathname: string, orgSlug: string): string | null {
  if (pathname === "/dashboard") return `/orgs/${orgSlug}/dashboard`;
  if (pathname === "/apps" || pathname.startsWith("/apps/")) {
    return `/orgs/${orgSlug}${pathname}`;
  }
  if (pathname === "/databases" || pathname.startsWith("/databases/")) {
    return `/orgs/${orgSlug}${pathname}`;
  }
  return null;
}

export const Route = createFileRoute("/_authed")({
  beforeLoad: async ({ location }): Promise<{ me: Me }> => {
    const me = await requireMe();

    const defaultSlug = me.default_organization?.slug;
    if (defaultSlug) {
      const canonical = canonicalizeLegacyPath(location.pathname, defaultSlug);
      if (canonical !== null) {
        throw redirect({ to: canonical, search: location.search });
      }
    }

    return { me };
  },
  component: () => (
    <EventsProvider>
      <AppShell banner={<SecondFactorBanner />}>
        <Outlet />
      </AppShell>
    </EventsProvider>
  ),
});
