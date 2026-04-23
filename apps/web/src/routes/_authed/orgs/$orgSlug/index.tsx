// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/orgs/$orgSlug/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      href: `/orgs/${params.orgSlug}/dashboard`,
      replace: true,
    });
  },
  component: () => null,
});
