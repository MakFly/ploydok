// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_public/")({
  beforeLoad: () => {
    throw redirect({ to: "/login" })
  },
  component: () => null,
})
