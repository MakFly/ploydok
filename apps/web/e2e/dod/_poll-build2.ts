// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shared helper: poll until a build *newer* than `afterBuildId` succeeds.
 *
 * The harness `pollBuildStatus` always inspects builds[0]. After triggerDeploy
 * the new build initially appears in the queue; builds[0] may still show the
 * previously-succeeded build. This variant waits until builds[0].id !== afterBuildId,
 * then tracks the new build to terminal state.
 *
 * Prefixed `_` so Playwright ignores this file as a spec.
 */

import { API_URL } from "./_harness"
import type { AuthContext, BuildRow } from "./_harness"

export interface Poll2Opts {
  /** Maximum wait in ms. Default 180_000. */
  timeoutMs?: number
  /** Polling interval in ms. Default 2_000. */
  intervalMs?: number
}

/**
 * Poll GET /apps/:id until a build with id !== afterBuildId appears at
 * builds[0] AND its status is "succeeded".
 *
 * Throws if:
 *   - The new build enters "failed" status.
 *   - The timeout elapses without the new build appearing or succeeding.
 */
export async function pollBuildStatus2(
  auth: AuthContext,
  appId: string,
  afterBuildId: string,
  opts: Poll2Opts = {},
): Promise<BuildRow> {
  const timeoutMs = opts.timeoutMs ?? 180_000
  const intervalMs = opts.intervalMs ?? 2_000
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const res = await fetch(`${API_URL}/apps/${appId}`, {
      headers: { cookie: auth.cookie },
    })

    if (res.ok) {
      const data = (await res.json()) as { builds: Array<BuildRow> }
      const newest = data.builds[0]

      if (newest !== undefined && newest.id !== afterBuildId) {
        // The new build is at the head of the list.
        if (newest.status === "succeeded") return newest
        if (newest.status === "failed") {
          throw new Error(
            `pollBuildStatus2: build ${newest.id} failed — ${newest.errorMessage ?? "(no message)"}`,
          )
        }
        // Build still running — keep polling.
      }
    }

    await new Promise<void>((r) => setTimeout(r, intervalMs))
  }

  throw new Error(
    `pollBuildStatus2: no build newer than ${afterBuildId} for app ${appId} reached "succeeded" within ${timeoutMs} ms`,
  )
}
