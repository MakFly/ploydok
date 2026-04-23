// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from "@tanstack/react-router";
import { DatabasesPage } from "../../../databases/index";

export const Route = createFileRoute("/_authed/orgs/$orgSlug/databases/")({
  component: DatabasesPage,
});
