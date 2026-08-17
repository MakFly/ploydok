// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"

/** Below this, a spinner is not readable. Above, the UI feels laggy. */
export const DEFAULT_MIN_VISIBLE_MS = 500

export interface PendingActionOptions {
  /** Minimum time `run` takes to settle. Defaults to 500ms. */
  minVisibleMs?: number
  /**
   * Leave `pending` true after a success instead of releasing it. For actions
   * that leave the page: the component is about to unmount, and releasing the
   * flag would flash the idle state one frame before the new page paints.
   */
  keepPendingOnSuccess?: boolean
  /** Side channel for logging. The error is rethrown either way. */
  onError?: (error: unknown) => void
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * React-free core, exported for tests.
 *
 * `Promise.all` is what makes this work: it does not append latency after the
 * action, it prevents the whole call from settling before the floor. A caller
 * that awaits this and only then navigates inherits the guarantee for free.
 * Errors reject immediately, without the floor, because the error message is
 * itself the feedback.
 */
export async function runPendingAction<T>(
  action: () => Promise<T>,
  options: Pick<PendingActionOptions, "minVisibleMs" | "onError"> = {}
): Promise<T> {
  const { minVisibleMs = DEFAULT_MIN_VISIBLE_MS, onError } = options
  try {
    const [result] = await Promise.all([action(), delay(minVisibleMs)])
    return result
  } catch (error) {
    onError?.(error)
    throw error
  }
}

export interface PendingAction<TArgs extends Array<unknown>, T> {
  pending: boolean
  run: (...args: TArgs) => Promise<T>
  /** Release `pending` by hand, e.g. after showing a sticky error. */
  reset: () => void
}

/**
 * Holds a pending flag for at least `minVisibleMs` so a fast action does not
 * flash a loading state on and off. Composes with TanStack Query rather than
 * replacing it: pass `() => mutation.mutateAsync(vars)` and the mutation keeps
 * its own lifecycle, callbacks and error state.
 */
export function usePendingAction<TArgs extends Array<unknown>, T>(
  action: (...args: TArgs) => Promise<T>,
  options: PendingActionOptions = {}
): PendingAction<TArgs, T> {
  const [pending, setPending] = React.useState(false)
  const mountedRef = React.useRef(true)
  const actionRef = React.useRef(action)
  const optionsRef = React.useRef(options)

  actionRef.current = action
  optionsRef.current = options

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const run = React.useCallback(async (...args: TArgs): Promise<T> => {
    const { keepPendingOnSuccess = false, ...core } = optionsRef.current
    setPending(true)
    try {
      const result = await runPendingAction(
        () => actionRef.current(...args),
        core
      )
      if (!keepPendingOnSuccess && mountedRef.current) setPending(false)
      return result
    } catch (error) {
      if (mountedRef.current) setPending(false)
      throw error
    }
  }, [])

  const reset = React.useCallback(() => {
    if (mountedRef.current) setPending(false)
  }, [])

  return { pending, run, reset }
}
