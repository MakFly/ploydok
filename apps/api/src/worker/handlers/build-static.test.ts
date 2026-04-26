// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, test, beforeEach } from "bun:test"
import { mkdir, mkdtemp, rm, readlink, readdir } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { existsSync } from "node:fs"
import { gcOldShas, promoteSha, runStaticBuild } from "./build-static"

let workspaceRoot: string

beforeEach(async () => {
  workspaceRoot = await mkdtemp(path.join(tmpdir(), "ploydok-static-test-"))
  Bun.env["PLOYDOK_STATIC_ROOT"] = workspaceRoot
})

afterEach(async () => {
  delete Bun.env["PLOYDOK_STATIC_ROOT"]
  await rm(workspaceRoot, { recursive: true, force: true })
})

describe("build-static", () => {
  test("runStaticBuild crée le dossier sha + symlink current", async () => {
    const r = await runStaticBuild({
      appId: "app1",
      sha: "abc123",
      sourceDir: "/tmp/nonexistent",
    })
    expect(existsSync(r.shaDir)).toBe(true)
    const link = await readlink(r.currentSymlink)
    expect(link).toBe("abc123")
  })

  test("promoteSha repointe atomiquement vers un nouveau SHA", async () => {
    await runStaticBuild({
      appId: "app1",
      sha: "v1",
      sourceDir: "/tmp/x",
    })
    // simule un 2e build
    const v2dir = path.join(workspaceRoot, "app1", "v2")
    await mkdir(v2dir, { recursive: true })
    await promoteSha("app1", "v2")

    const link = await readlink(path.join(workspaceRoot, "app1", "current"))
    expect(link).toBe("v2")
  })

  test("promoteSha throw si SHA absent", async () => {
    await expect(promoteSha("app1", "missing")).rejects.toThrow(
      /promoteSha: missing/
    )
  })

  test("gcOldShas garde keepN + préserve current", async () => {
    // Crée 5 builds successifs : v1, v2, v3, v4, v5 — current = v5
    for (const v of ["v1", "v2", "v3", "v4", "v5"]) {
      await runStaticBuild({ appId: "app1", sha: v, sourceDir: "/tmp/x" })
    }
    const deleted = await gcOldShas("app1", 3)
    // tri par nom DESC : [v5, v4, v3, v2, v1] → garde 3 premiers, target = [v2, v1]
    // v5 = current → exclu de delete dans tous les cas
    expect(deleted).toBe(2)
    const remaining = (
      await readdir(path.join(workspaceRoot, "app1"), { withFileTypes: true })
    )
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
    expect(remaining).toContain("v3")
    expect(remaining).toContain("v4")
    expect(remaining).toContain("v5") // current preserved
    expect(remaining).not.toContain("v1")
    expect(remaining).not.toContain("v2")
  })
})
