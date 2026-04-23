// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from "@tanstack/react-router";
import { ShellPage } from "../../../../apps/$id/shell";

export const Route = createFileRoute("/_authed/orgs/$orgSlug/apps/$id/shell")({
  component: ShellPage,
});
