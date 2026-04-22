// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { BasicAuthForm } from "../../../../../components/protection/BasicAuthForm"
import { IpAllowlistForm } from "../../../../../components/protection/IpAllowlistForm"
import { RateLimitForm } from "../../../../../components/protection/RateLimitForm"
import { Separator } from "@workspace/ui/components/separator"

export const Route = createFileRoute("/_authed/apps/$id/settings/protection")({
  component: ProtectionPage,
})

function ProtectionPage(): React.JSX.Element {
  const { id } = Route.useParams()

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold">Access Protection</h2>
        <p className="text-sm text-muted-foreground">
          Caddy-level protection applied before traffic reaches your app.
        </p>
      </div>

      <div className="flex flex-col gap-6">
        <BasicAuthForm appId={id} />
        <Separator />
        <IpAllowlistForm appId={id} />
        <Separator />
        <RateLimitForm appId={id} />
      </div>
    </div>
  )
}
