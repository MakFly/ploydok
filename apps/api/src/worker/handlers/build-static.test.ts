// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, test, beforeEach } from "bun:test"
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  readFile,
  readlink,
  readdir,
  writeFile,
} from "node:fs/promises"
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

async function createStaticProject(): Promise<string> {
  const projectDir = await mkdtemp(path.join(tmpdir(), "ploydok-static-src-"))
  const builderDir = path.join(projectDir, "vendor", "static-builder")
  await mkdir(builderDir, { recursive: true })
  await writeFile(
    path.join(builderDir, "package.json"),
    JSON.stringify({
      name: "static-builder",
      version: "1.0.0",
      bin: { "static-builder": "bin.js" },
    })
  )
  await writeFile(
    path.join(builderDir, "bin.js"),
    `#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "node:fs"
mkdirSync("dist/assets", { recursive: true })
writeFileSync("dist/index.html", '<!doctype html><div id="app">static-ok</div>')
writeFileSync("dist/assets/app.css", "body{color:#123456}")
`
  )
  await chmod(path.join(builderDir, "bin.js"), 0o755)
  await writeFile(
    path.join(projectDir, "package.json"),
    JSON.stringify({
      scripts: { build: "static-builder" },
      dependencies: { "static-builder": "file:./vendor/static-builder" },
    })
  )
  return projectDir
}

describe("build-static", () => {
  test("runStaticBuild construit un vrai projet static et publie current", async () => {
    const projectDir = await createStaticProject()
    const logs: string[] = []
    const r = await runStaticBuild({
      appId: "app1",
      sha: "abc123",
      sourceDir: projectDir,
      onLog: (line) => logs.push(line),
    })
    expect(logs[0]).toContain(" install --no-save")
    expect(
      logs.findIndex((line) => line.includes(" install --no-save"))
    ).toBeLessThan(logs.findIndex((line) => line.includes(" run build")))
    expect(existsSync(r.shaDir)).toBe(true)
    expect(await readFile(path.join(r.shaDir, "index.html"), "utf8")).toContain(
      "static-ok"
    )
    const link = await readlink(r.currentSymlink)
    expect(link).toBe("abc123")
    await rm(projectDir, { recursive: true, force: true })
  })

  test("promoteSha repointe atomiquement vers un nouveau SHA", async () => {
    await runStaticBuild({
      appId: "app1",
      sha: "v1",
      sourceDir: await createStaticProject(),
    })
    // simule un 2e build
    const v2dir = path.join(workspaceRoot, "app1", "v2")
    await mkdir(v2dir, { recursive: true })
    await promoteSha("app1", "v2")

    const link = await readlink(path.join(workspaceRoot, "app1", "current"))
    expect(link).toBe("v2")
  })

  test("une racine non inscriptible remonte un message actionnable", async () => {
    await chmod(workspaceRoot, 0o555)
    try {
      await expect(
        runStaticBuild({
          appId: "app1",
          sha: "abc123",
          sourceDir: await createStaticProject(),
        })
      ).rejects.toThrow(/PLOYDOK_STATIC_ROOT/)
    } finally {
      await chmod(workspaceRoot, 0o755)
    }
  })

  test("promoteSha throw si SHA absent", async () => {
    await expect(promoteSha("app1", "missing")).rejects.toThrow(
      /promoteSha: missing/
    )
  })

  test("une annulation avant publication conserve la génération active", async () => {
    await runStaticBuild({
      appId: "app1",
      sha: "v1",
      sourceDir: await createStaticProject(),
    })
    await expect(
      runStaticBuild({
        appId: "app1",
        sha: "v2",
        sourceDir: await createStaticProject(),
        beforePublish: async () => {
          throw new Error("cancelled")
        },
      })
    ).rejects.toThrow("cancelled")
    expect(await readlink(path.join(workspaceRoot, "app1", "current"))).toBe(
      "v1"
    )
    expect(existsSync(path.join(workspaceRoot, "app1", "v2"))).toBe(false)
  })

  test("gcOldShas garde keepN + préserve current", async () => {
    // Crée 5 builds successifs : v1, v2, v3, v4, v5 — current = v5
    for (const v of ["v1", "v2", "v3", "v4", "v5"]) {
      await runStaticBuild({
        appId: "app1",
        sha: v,
        sourceDir: await createStaticProject(),
      })
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
