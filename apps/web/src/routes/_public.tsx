// SPDX-License-Identifier: AGPL-3.0-only
import { Outlet, createFileRoute } from "@tanstack/react-router"
import {
  enforceInstanceState,
  redirectIfAuthenticated,
} from "../lib/auth-guards"

export const Route = createFileRoute("/_public")({
  beforeLoad: async ({ location }) => {
    await enforceInstanceState(location.pathname)
    if (location.pathname !== "/setup") {
      await redirectIfAuthenticated()
    }
  },
  component: () => <Outlet />,
})
