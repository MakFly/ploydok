// SPDX-License-Identifier: AGPL-3.0-only
//
// useDeploymentToasts — surface un toast sonner à chaque fin de build.
// Monté une seule fois dans _authed.tsx pour éviter les doublons.
//
// Anti-replay : le ring-buffer serveur rejoue jusqu'à 20 events au reconnect
// SSE. Sans garde, tous les builds terminés passés déclencheraient un toast
// au mount. `mountedAt` filtre ces events : on n'affiche que ce qui est
// arrivé APRÈS le montage du hook.

import * as React from "react"
import { toast } from "sonner"
import { useEventsSubscription } from "./events-provider"
import type { NotificationEvent } from "./notifications"

export function useDeploymentToasts(): void {
  const mountedAt = React.useRef(Date.now())

  const onSucceeded = React.useCallback((evt: NotificationEvent) => {
    if (evt.t < mountedAt.current) return
    toast.success(evt.message)
  }, [])

  const onFailed = React.useCallback((evt: NotificationEvent) => {
    if (evt.t < mountedAt.current) return
    toast.error(evt.message)
  }, [])

  useEventsSubscription<NotificationEvent>("build.succeeded", onSucceeded)
  useEventsSubscription<NotificationEvent>("build.failed", onFailed)
}
