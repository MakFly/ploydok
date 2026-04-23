// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, redirect } from "@tanstack/react-router";
import { apiFetch } from "../../../../../lib/api";
import { AppDetailLayout } from "../../../apps/$id";
import type { AppDetail } from "../../../../../lib/apps";
import type { OrganizationSummary } from "@ploydok/shared";

export const Route = createFileRoute("/_authed/orgs/$orgSlug/apps/$id")({
  loader: async ({ params }) => {
    const organizationData = await apiFetch<{ organization: OrganizationSummary }>(
      `/organizations/${params.orgSlug}`,
    );
    const { app } = await apiFetch<{ app: AppDetail; builds: Array<unknown> }>(
      `/apps/${params.id}`,
    );
    const data = { app };
    if (
      data.app.organizationId &&
      data.app.organizationId !== organizationData.organization.id
    ) {
      throw redirect({ href: `/orgs/${params.orgSlug}/apps`, replace: true });
    }
    return data;
  },
  component: AppDetailLayout,
});
