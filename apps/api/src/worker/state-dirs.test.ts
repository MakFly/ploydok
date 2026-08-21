// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from "bun:test"
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { probeStateDir, stateDirRemediation } from "./state-dirs"

const created: string[] = []

afterEach(async () => {
  for (const dir of created.splice(0)) {
    await chmod(dir, 0o755).catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
})

describe("probeStateDir", () => {
  it("creates the directory when it does not exist yet", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "ploydok-state-dirs-"))
    created.push(base)
    const target = path.join(base, "static")

    const probe = await probeStateDir("static", target)

    expect(probe.writable).toBe(true)
    expect(probe.error).toBeUndefined()
  })

  it("reports a directory owned by someone else as not writable", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "ploydok-state-dirs-"))
    created.push(base)
    const target = path.join(base, "static")
    await mkdir(target)
    await chmod(target, 0o555)

    const probe = await probeStateDir("static", target)

    expect(probe.writable).toBe(false)
    expect(probe.error).toContain("EACCES")
  })

  it("names the env var that overrides the failing directory", () => {
    expect(
      stateDirRemediation({ label: "static", dir: "/x", writable: false })
    ).toContain("PLOYDOK_STATIC_ROOT")
    expect(
      stateDirRemediation({ label: "builds", dir: "/x", writable: false })
    ).toContain("PLOYDOK_BUILD_DIR")
  })
})
