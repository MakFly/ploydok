// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/orgs/$orgSlug/apps/$id/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      href: `/orgs/${params.orgSlug}/apps/${params.id}/overview`,
      replace: true,
    });
  },
  component: () => null,
});
