// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from "@tanstack/react-router";
import { AppsPage } from "../../../apps/index";

export const Route = createFileRoute("/_authed/orgs/$orgSlug/apps/")({
  component: AppsPage,
});
