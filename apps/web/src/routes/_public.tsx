// SPDX-License-Identifier: AGPL-3.0-only
import { Outlet, createFileRoute } from "@tanstack/react-router"
import { redirectIfAuthenticated } from "../lib/auth-guards"

export const Route = createFileRoute("/_public")({
  beforeLoad: async () => {
    await redirectIfAuthenticated()
  },
  component: () => <Outlet />,
})
