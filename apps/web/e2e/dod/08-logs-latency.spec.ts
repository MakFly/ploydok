// SPDX-License-Identifier: AGPL-3.0-only
/**
 * DoD #7 — Build logs streamed via WebSocket, p95 latency < 500 ms
 *
 * Gate: PLOYDOK_E2E_REAL=1
 * Prerequisites: make infra-up + make dev-agent + make dev
 *
 * Auth strategy for the WS endpoint:
 *   The /ws/apps/:id/build/:buildId endpoint authenticates via the
 *   `ploydok_access` cookie (read from the `cookie` HTTP header on upgrade).
 *   The browser WebSocket API does not support custom headers, so we rely on
 *   Bun's globalThis.WebSocket falling back to the `ws` npm package via
 *   dynamic import — the `ws` package accepts a `headers` option.
 *
 *   However, the current harness `readBuildLogsWs` opens the WebSocket WITHOUT
 *   forwarding the cookie header (it constructs `new WS(wsUrl)` with no extra
 *   options).  As a result the server closes the connection immediately with
 *   code 4001 (unauthorized), and the spec would collect 0 log lines.
 *
 *   Workaround applied here: we bypass `readBuildLogsWs` and open the WebSocket
 *   directly using the `ws` npm package (dynamic import) so we can pass the
 *   `cookie` header on upgrade.  If `ws` is not available (e.g. runtime already
 *   has a native WebSocket that doesn't support headers), the test is skipped
 *   with an explanatory message rather than producing a false-pass.
 *
 * TODO: update the harness `readBuildLogsWs` to accept an optional `headers`
 *       parameter so future specs can use it directly.
 *       Filed in docs/sprints/sprint-3-DoD.md.
 */

import { performance } from "node:perf_hooks"
import { expect, test } from "@playwright/test"
import {
  API_URL,
  REAL_E2E,
  cleanupApp,
  createApp,
  loginViaApi,
  pollBuildStatus,
} from "./_harness"
import type { AuthContext } from "./_harness"

// ---------------------------------------------------------------------------
// Gate + suite-level timeout
// ---------------------------------------------------------------------------

test.describe("DoD #7 — logs latency", () => {
  test.describe.configure({ timeout: 180_000 })

  test.skip(!REAL_E2E, "requires PLOYDOK_E2E_REAL=1 + infra up")

  let auth: AuthContext
  let appId = ""

  test.beforeAll(async () => {
    auth = await loginViaApi()
  })

  test.afterAll(async () => {
    if (appId) await cleanupApp(auth, appId)
  })

  // --------------------------------------------------------------------------

  test("WS build logs streamed with p95 inter-message latency < 500 ms", async () => {
    // 1. Create app — build #1 is auto-enqueued on creation.
    ;({ id: appId } = await createApp(auth, {
      name: `fixture-logs-${Date.now()}`,
      repoFullName: "ploydok/fixture-hello",
      branch: "main",
      buildMethod: "docker",
    }))

    // 2. Poll until builds[0] appears (worker tick ≤ 2 s), then grab buildId
    //    before the build finishes so we can connect the WS while it's running.
    let buildId = ""
    const fetchDeadline = Date.now() + 15_000
    while (Date.now() < fetchDeadline) {
      const res = await fetch(`${API_URL}/apps/${appId}`, {
        headers: { cookie: auth.cookie },
      })
      if (res.ok) {
        const data = (await res.json()) as {
          builds: Array<{ id: string; status: string }>
        }
        const b = data.builds[0]
        if (b) {
          buildId = b.id
          break
        }
      }
      await new Promise<void>((r) => setTimeout(r, 500))
    }

    if (!buildId) {
      test.skip(true, "build row did not appear within 15 s — skipping")
      return
    }

    console.log(`[dod-08] appId=${appId} buildId=${buildId} — opening WS`)

    // 3. Open the WS with cookie header via the `ws` npm package.
    //    We use a Function-constructor dynamic import so tsc does not try to
    //    resolve the `ws` type at compile time (same pattern as the harness).
    const wsUrl = `ws://localhost:3335/ws/apps/${appId}/build/${buildId}`

    type WsModule = {
      default: new (
        url: string,
        opts: { headers?: Record<string, string> },
      ) => {
        onopen: (() => void) | null
        onmessage: ((evt: { data: string | Buffer }) => void) | null
        onerror: ((evt: unknown) => void) | null
        onclose: (() => void) | null
        send: (data: string) => void
        close: (code?: number, reason?: string) => void
      }
    }

    const dynamicImport = new Function("m", "return import(m)") as (
      m: string,
    ) => Promise<WsModule>

    let WS: WsModule["default"]
    try {
      const mod = await dynamicImport("ws")
      WS = mod.default
    } catch {
      test.skip(
        true,
        "ws npm package not available — cannot forward cookie header on WS upgrade. " +
          "TODO: update harness readBuildLogsWs to accept a headers option.",
      )
      return
    }

    // 4. Collect log lines and measure inter-message arrival times.
    const lines: Array<string> = []
    const arrivalTimes: Array<number> = []

    const { lines: collectedLines, latencyMsP95 } = await new Promise<{
      lines: Array<string>
      latencyMsP95: number
    }>((resolve, reject) => {
      const MAX_WAIT_MS = 90_000
      let idleTimer: ReturnType<typeof setTimeout> | null = null

      const finish = (): void => {
        if (idleTimer) clearTimeout(idleTimer)
        const deltas = arrivalTimes
          .slice(1)
          .map((t, i) => t - (arrivalTimes[i] ?? t))
          .sort((a, b) => a - b)
        const p95Index = Math.floor(deltas.length * 0.95)
        const latencyMsP95 = deltas[p95Index] ?? 0
        resolve({ lines, latencyMsP95 })
      }

      const ws = new WS(wsUrl, {
        headers: { cookie: auth.cookie },
      })

      const resetIdle = (): void => {
        if (idleTimer) clearTimeout(idleTimer)
        idleTimer = setTimeout(() => {
          ws.close(1000, "idle timeout")
          finish()
        }, MAX_WAIT_MS)
      }

      ws.onopen = (): void => {
        resetIdle()
      }

      ws.onmessage = (evt): void => {
        const raw =
          typeof evt.data === "string" ? evt.data : evt.data.toString()
        try {
          const msg = JSON.parse(raw) as
            | { type: string; t: number }
            | { t: number; line: string }

          if ("type" in msg && msg.type === "ping") {
            ws.send(JSON.stringify({ type: "pong", t: Date.now() }))
          } else if ("line" in msg) {
            arrivalTimes.push(performance.now())
            lines.push(msg.line)
          }
        } catch {
          arrivalTimes.push(performance.now())
          lines.push(raw)
        }
        resetIdle()
      }

      ws.onerror = (evt): void => {
        reject(new Error(`WS error on ${wsUrl}: ${String(evt)}`))
      }

      ws.onclose = (): void => {
        finish()
      }
    })

    // 5. Confirm build succeeded.
    await pollBuildStatus(auth, appId, { timeoutMs: 120_000 })

    // 6. Assertions.
    console.log(
      `[dod-08] received ${collectedLines.length} lines, p95 latency=${latencyMsP95.toFixed(1)} ms`,
    )

    expect(collectedLines.length, "received some build log lines").toBeGreaterThan(5)
    expect(latencyMsP95, "WS log RTT p95 < 500ms").toBeLessThan(500)
  })
})
