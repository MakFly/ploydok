// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test"
import {
  inferContainerColor,
  legacyRuntimeContainerName,
  normalizeRuntimeContainerSlug,
  runtimeContainerName,
  runtimeContainerNameCandidates,
  runtimeContainerShortId,
} from "./runtime-containers"

describe("runtime container naming", () => {
  it("normalizes slug text for Docker-safe readable names", () => {
    expect(normalizeRuntimeContainerSlug("Hello / Runtime_App")).toBe(
      "hello-runtime-app",
    )
  })

  it("uses slug + short id + color for the primary name", () => {
    expect(
      runtimeContainerName(
        { id: "3gfA0pcC3DRtNqqNPWioi", slug: "my-app" },
        "blue",
      ),
    ).toBe("ploydok-app-my-app-3gfa0pcc-blue")
  })

  it("keeps the legacy raw-id format as a compatibility candidate", () => {
    expect(
      runtimeContainerNameCandidates(
        { id: "3gfA0pcC3DRtNqqNPWioi", slug: "my-app" },
        "green",
      ),
    ).toEqual([
      "ploydok-app-my-app-3gfa0pcc-green",
      "ploydok-app-3gfa0pcc3drtnqqnpwioi-green",
    ])
  })

  it("treats containers with matching app_id and no kind label as app containers", async () => {
    const { resolveRuntimeContainer } = await import("./runtime-containers")
    const result = await resolveRuntimeContainer(
      {
        listContainers: async () => ({
          containers: [
            {
              id: "ctr-1",
              name: "ploydok-app-my-app-3gfa0pcc-blue",
              image: "registry/app:tag",
              status: "running",
              uptimeS: 10,
              cpuPct: 1,
              memBytes: 1,
              memLimitBytes: 10,
              restartCount: 0,
              kind: "",
              appId: "3gfA0pcC3DRtNqqNPWioi",
              color: "blue",
              lastPingMs: 0,
              lastPingOk: false,
              lastSeenMs: Date.now(),
            },
          ],
        }),
      } as never,
      { appId: "3gfA0pcC3DRtNqqNPWioi" },
    )

    expect(result?.id).toBe("ctr-1")
  })

  it("infers color from either legacy or new-style container refs", () => {
    expect(inferContainerColor("ploydok-app-my-app-3gfa0pcc-blue")).toBe("blue")
    expect(
      inferContainerColor(legacyRuntimeContainerName("3gfA0pcC3DRtNqqNPWioi", "green")),
    ).toBe("green")
    expect(inferContainerColor("ploydok-app-no-color")).toBeNull()
  })

  it("derives a stable lowercase short id", () => {
    expect(runtimeContainerShortId("3gfA0pcC3DRtNqqNPWioi")).toBe("3gfa0pcc")
  })
})
