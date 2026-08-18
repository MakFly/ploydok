// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { clearInvitationTokenOnTerminalError } from "../../lib/memberships"

export function InvitationTokenLifecycle({
  urlToken,
  error,
}: {
  urlToken: string
  error: unknown
}): null {
  React.useEffect(() => {
    if (!urlToken || typeof window === "undefined") return
    window.sessionStorage.setItem("ploydok.invitation-token", urlToken)
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname
    )
  }, [urlToken])

  React.useEffect(() => {
    if (typeof window === "undefined") return
    clearInvitationTokenOnTerminalError(window.sessionStorage, error)
  }, [error])

  return null
}
