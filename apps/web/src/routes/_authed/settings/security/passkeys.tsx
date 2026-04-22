// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_authed/settings/security/passkeys")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/security/passkey" })
  },
  component: () => null,
})
