// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { BasicAuthForm } from "../protection/BasicAuthForm"
import { IpAllowlistForm } from "../protection/IpAllowlistForm"
import { RateLimitForm } from "../protection/RateLimitForm"
import { Separator } from "@workspace/ui/components/separator"

export function ProtectionSection({
  appId,
}: {
  appId: string
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <BasicAuthForm appId={appId} />
      <Separator />
      <IpAllowlistForm appId={appId} />
      <Separator />
      <RateLimitForm appId={appId} />
    </div>
  )
}
