// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useRouterState } from "@tanstack/react-router"

/** Nothing paints before this, so instant navigations never flicker. */
const APPEAR_DELAY_MS = 150
/** The bar creeps toward this while loading, and never reaches it. */
const MAX_PROGRESS = 92
const TICK_FACTOR = 0.15
const TICK_MS = 200
const FADE_MS = 200

export type ProgressPhase = "idle" | "appearing" | "growing" | "done"

/**
 * A navigation that ends while still in `appearing` goes back to `idle`, never
 * to `done`: it was too short to be worth showing at all.
 */
export function nextPhase(
  phase: ProgressPhase,
  isLoading: boolean
): ProgressPhase {
  if (isLoading) return phase === "idle" ? "appearing" : phase
  return phase === "growing" || phase === "done" ? "done" : "idle"
}

export function tickProgress(progress: number): number {
  return progress + (MAX_PROGRESS - progress) * TICK_FACTOR
}

/**
 * Global navigation indicator. `isLoading` is the only usable signal in this
 * router build: it is raised in beforeLoad and cleared once every loader has
 * resolved, which is exactly the wait the user perceives. `isTransitioning`
 * exists in the types but is never set, so it must not be used.
 */
export function NavigationProgress(): React.JSX.Element | null {
  const isLoading = useRouterState({ select: (state) => state.isLoading })
  const [mounted, setMounted] = React.useState(false)
  const [phase, setPhase] = React.useState<ProgressPhase>("idle")
  const [progress, setProgress] = React.useState(0)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  React.useEffect(() => {
    if (!mounted) return
    setPhase((current) => nextPhase(current, isLoading))
  }, [mounted, isLoading])

  React.useEffect(() => {
    if (phase !== "appearing") return
    const timer = setTimeout(() => {
      setProgress(20)
      setPhase("growing")
    }, APPEAR_DELAY_MS)
    return () => clearTimeout(timer)
  }, [phase])

  React.useEffect(() => {
    if (phase !== "growing") return
    const timer = setInterval(() => setProgress(tickProgress), TICK_MS)
    return () => clearInterval(timer)
  }, [phase])

  React.useEffect(() => {
    if (phase !== "done") return
    setProgress(100)
    const timer = setTimeout(() => {
      setPhase("idle")
      setProgress(0)
    }, FADE_MS)
    return () => clearTimeout(timer)
  }, [phase])

  if (!mounted || phase === "idle" || phase === "appearing") return null

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[2px]"
    >
      <div
        className="h-full bg-[image:var(--gradient-primary)] transition-[width,opacity] duration-200 ease-out motion-reduce:transition-none"
        style={{ width: `${progress}%`, opacity: phase === "done" ? 0 : 1 }}
      />
    </div>
  )
}
