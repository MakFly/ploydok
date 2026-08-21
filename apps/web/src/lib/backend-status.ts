// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import i18n from "./i18n"
import { apiBaseUrl } from "./api/base"

export interface BackendUnavailableState {
  active: boolean
  message: string
}

type Listener = () => void

function defaultMessage(): string {
  return i18n.t("errors:backendUnavailableBody", { url: apiBaseUrl() })
}

let state: BackendUnavailableState = {
  active: false,
  message: defaultMessage(),
}

const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function getBackendUnavailableState(): BackendUnavailableState {
  return state
}

export function setBackendUnavailable(message = defaultMessage()): void {
  state = { active: true, message }
  emit()
}

export function clearBackendUnavailable(): void {
  if (!state.active) return
  state = { active: false, message: defaultMessage() }
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
