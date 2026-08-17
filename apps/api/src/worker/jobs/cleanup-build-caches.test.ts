// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, spyOn } from "bun:test"
import { mkdtemp, mkdir, rm, stat, utimes, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  cleanupBuildCaches,
  pruneDockerBuildCache,
  stopCleanupBuildCachesCron,
} from "./cleanup-build-caches"

const roots: string[] = []

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ploydok-cache-test-"))
  roots.push(root)
  return root
}

async function touchDir(dir: string, date: Date): Promise<void> {
  await utimes(dir, date, date)
}

describe("cleanupBuildCaches", () => {
  afterEach(async () => {
    stopCleanupBuildCachesCron()
    await Promise.all(
      roots.splice(0).map((root) =>
        rm(root, {
          recursive: true,
          force: true,
        })
      )
    )
  })

  it("removes stale app build cache directories", async () => {
    const root = await makeRoot()
    const cacheDir = path.join(root, "app-1", ".nixpacks-cache")
    await mkdir(cacheDir, { recursive: true })
    await writeFile(path.join(cacheDir, "layer"), "cached")
    await touchDir(cacheDir, new Date("2026-04-20T08:00:00.000Z"))

    const result = await cleanupBuildCaches({
      rootDir: root,
      now: new Date("2026-05-10T08:00:00.000Z"),
    })

    expect(result.appsScanned).toBe(1)
    expect(result.cacheDirsScanned).toBe(1)
    expect(result.removedDirs).toBe(1)
    expect(result.removedBytes).toBe(6)
    await expect(stat(cacheDir)).rejects.toThrow()
  })

  it("keeps recent app build cache directories", async () => {
    const root = await makeRoot()
    const cacheDir = path.join(root, "app-1", ".buildkit-cache")
    await mkdir(cacheDir, { recursive: true })
    await writeFile(path.join(cacheDir, "layer"), "cached")
    await touchDir(cacheDir, new Date("2026-05-09T08:00:00.000Z"))

    const result = await cleanupBuildCaches({
      rootDir: root,
      now: new Date("2026-05-10T08:00:00.000Z"),
    })

    expect(result.removedDirs).toBe(0)
    expect((await stat(cacheDir)).isDirectory()).toBe(true)
  })

  it("prunes the host Docker cache reported by docker system df", async () => {
    const spawnSpy = spyOn(Bun, "spawn").mockReturnValue({
      stdout: new Response("ID RECLAIMABLE SIZE\n").body!,
      stderr: new Response("").body!,
      exited: Promise.resolve(0),
    } as unknown as ReturnType<typeof Bun.spawn>)

    const result = await pruneDockerBuildCache({
      keepDuration: "24h",
      keepStorage: "5g",
    })

    expect(result.ok).toBe(true)
    expect(spawnSpy).toHaveBeenCalledWith(
      [
        "docker",
        "builder",
        "prune",
        "--filter",
        "until=24h",
        "--reserved-space",
        "5g",
        "--force",
      ],
      { stdout: "pipe", stderr: "pipe" }
    )
    spawnSpy.mockRestore()
  })

  it("returns Docker stderr as the actionable failure message", async () => {
    const spawnSpy = spyOn(Bun, "spawn").mockReturnValue({
      stdout: new Response("").body!,
      stderr: new Response(
        "ERROR: failed to connect to the Docker daemon"
      ).body!,
      exited: Promise.resolve(1),
    } as unknown as ReturnType<typeof Bun.spawn>)

    const result = await pruneDockerBuildCache()

    expect(result).toEqual({
      ok: false,
      exitCode: 1,
      output:
        "ERROR: failed to connect to the Docker daemon",
      error: "ERROR: failed to connect to the Docker daemon",
    })
    spawnSpy.mockRestore()
  })
})
