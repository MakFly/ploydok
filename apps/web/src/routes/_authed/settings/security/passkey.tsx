// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from "@tanstack/react-router"
import { SecurityPasskeysPanel } from "../../../../components/settings/SecurityPasskeysPanel"

export const Route = createFileRoute("/_authed/settings/security/passkey")({
  component: SecurityPasskeysPanel,
})
