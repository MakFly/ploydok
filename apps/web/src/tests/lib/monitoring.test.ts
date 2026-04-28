// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test"
import { getContainerHealthSnapshot } from "../../lib/monitoring"
import type { ContainerSnapshot } from "@ploydok/shared"

const snapshot: ContainerSnapshot = {
  id: "ctr-1",
  name: "ploydok-app-demo-blue",
  image: "127.0.0.1:5000/ploydok/app-demo:sha",
  status: "running",
  uptime_s: 12,
  cpu_pct: 1.5,
  mem_bytes: 1024,
  mem_limit_bytes: 2048,
  restart_count: 0,
  kind: "app",
  app_id: "app-1",
  color: "blue",
  last_seen_ms: 1000,
}

describe("getContainerHealthSnapshot", () => {
  it("reads the snapshot from the notification data envelope", () => {
    expect(
      getContainerHealthSnapshot({
        appId: "app-1",
        data: { container: snapshot, prev_status: "starting" },
      })
    ).toEqual(snapshot)
  })

  it("returns null when the event has no container snapshot", () => {
    expect(getContainerHealthSnapshot({ appId: "app-1", data: {} })).toBeNull()
  })
})
