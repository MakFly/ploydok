// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"

export interface BackendUnavailableState {
  active: boolean
  message: string
}

type Listener = () => void

const DEFAULT_MESSAGE =
  "Le frontend ne parvient plus a joindre l'API. Verifie que le backend est demarre, puis reessaie."

let state: BackendUnavailableState = {
  active: false,
  message: DEFAULT_MESSAGE,
}

const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function getBackendUnavailableState(): BackendUnavailableState {
  return state
}

export function setBackendUnavailable(message = DEFAULT_MESSAGE): void {
  state = { active: true, message }
  emit()
}

export function clearBackendUnavailable(): void {
  if (!state.active) return
  state = { active: false, message: DEFAULT_MESSAGE }
  emit()
}

export function subscribeBackendUnavailable(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useBackendUnavailable(): BackendUnavailableState {
  return React.useSyncExternalStore(
    subscribeBackendUnavailable,
    getBackendUnavailableState,
    getBackendUnavailableState,
  )
}
