// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, redirect } from "@tanstack/react-router";

// Redirect /apps/:id → /apps/:id/overview
export const Route = createFileRoute("/_authed/apps/$id/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/apps/$id/overview",
      params: { id: params.id },
      replace: true,
    });
  },
  component: () => null,
});
