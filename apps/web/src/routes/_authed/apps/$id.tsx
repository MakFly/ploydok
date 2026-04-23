// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from "@tanstack/react-router"
import { AppDetailLayout, loadAppDetail } from "../../../pages/apps/$id"
import type { AppDetail } from "../../../lib/apps"

export const Route = createFileRoute("/_authed/apps/$id")({
  loader: async ({ params }): Promise<{ app: AppDetail }> => loadAppDetail(params.id),
  component: AppDetailLayout,
})
