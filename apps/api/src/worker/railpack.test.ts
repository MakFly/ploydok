// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Unit tests for railpackBuild().
 *
 * The `railpack` binary is not available in the test environment.
 * We mock `ensureRailpackInstalled` to return a fake path and spy on
 * `Bun.spawn` to verify command construction, env injection, log streaming
 * and error handling without running an actual build.
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import os from "node:os"
import * as railpackMod from "./railpack"

function fakeBunProcess(opts: {
  stdoutLines?: string[]
  stderrLines?: string[]
  exitCode?: number
}) {
  const stdoutText =
    (opts.stdoutLines ?? []).join("\n") + (opts.stdoutLines?.length ? "\n" : "")
  const stderrText =
    (opts.stderrLines ?? []).join("\n") + (opts.stderrLines?.length ? "\n" : "")
  const enc = new TextEncoder()

  function makeStream(text: string): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(controller) {
        if (text) controller.enqueue(enc.encode(text))
        controller.close()
      },
    })
  }

  return {
    stdout: makeStream(stdoutText),
    stderr: makeStream(stderrText),
    exited: Promise.resolve(opts.exitCode ?? 0),
    exitCode: opts.exitCode ?? 0,
  }
}

describe("railpackBuild", () => {
  let tmpDir: string
  let spawnSpy: ReturnType<typeof spyOn>
  let ensureSpy: ReturnType<typeof spyOn>

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "ploydok-railpack-test-"))
    ensureSpy = spyOn(railpackMod, "ensureRailpackInstalled").mockResolvedValue(
      "/usr/local/bin/railpack"
    )
  })

  afterEach(async () => {
    spawnSpy?.mockRestore?.()
    ensureSpy?.mockRestore?.()
    await rm(tmpDir, { recursive: true, force: true })
  })

  it("invokes railpack with build + ctx + --name <tag>", async () => {
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      fakeBunProcess({}) as ReturnType<typeof Bun.spawn>
    )

    await railpackMod.railpackBuild({
      workspacePath: tmpDir,
      tag: "127.0.0.1:5000/app-abc:sha123",
    })

    const spawnMock = spawnSpy as unknown as {
      mock: { calls: Array<[unknown[], unknown]> }
    }
    expect(spawnMock.mock.calls.length).toBe(1)
    const cmd = spawnMock.mock.calls[0]![0] as string[]
    expect(cmd[0]).toBe("/usr/local/bin/railpack")
    expect(cmd).toContain("build")
    expect(cmd).toContain(tmpDir)
    expect(cmd).toContain("--name")
    expect(cmd).toContain("127.0.0.1:5000/app-abc:sha123")
  })

  it("uses rootDir as build ctx when provided", async () => {
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      fakeBunProcess({}) as ReturnType<typeof Bun.spawn>
    )

    await railpackMod.railpackBuild({
      workspacePath: tmpDir,
      rootDir: "apps/web",
      tag: "127.0.0.1:5000/app-abc:sha",
    })

    const spawnMock = spawnSpy as unknown as {
      mock: { calls: Array<[unknown[], unknown]> }
    }
    const cmd = spawnMock.mock.calls[0]![0] as string[]
    expect(cmd).toContain(path.join(tmpDir, "apps/web"))
  })

  it("creates cacheDir when provided", async () => {
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      fakeBunProcess({}) as ReturnType<typeof Bun.spawn>
    )

    const cacheDir = path.join(tmpDir, "nested", ".railpack-cache")

    await railpackMod.railpackBuild({
      workspacePath: tmpDir,
      tag: "127.0.0.1:5000/app-abc:sha",
      cacheDir,
    })

    expect(existsSync(cacheDir)).toBe(true)
  })

  it("passes buildEnv via --env flags AND process env", async () => {
    let spawnEnv: Record<string, string> | undefined
    spawnSpy = spyOn(Bun, "spawn").mockImplementation(((...args: unknown[]) => {
      const opts = (args.length === 1 ? args[0] : args[1]) as
        | { env?: Record<string, string> }
        | undefined
      spawnEnv = opts?.env
      return fakeBunProcess({}) as ReturnType<typeof Bun.spawn>
    }) as typeof Bun.spawn)

    await railpackMod.railpackBuild({
      workspacePath: tmpDir,
      tag: "127.0.0.1:5000/app-abc:sha",
      buildEnv: { NEXT_PUBLIC_API_URL: "https://api.example.com" },
    })

    const spawnMock = spawnSpy as unknown as {
      mock: { calls: Array<[unknown[], unknown]> }
    }
    const cmd = spawnMock.mock.calls[0]![0] as string[]
    expect(cmd).toContain("--env")
    expect(cmd).toContain("NEXT_PUBLIC_API_URL=https://api.example.com")
    expect(spawnEnv?.["NEXT_PUBLIC_API_URL"]).toBe("https://api.example.com")
  })

  it("streams stdout via onLog", async () => {
    const lines = ["[railpack] step 1", "[railpack] step 2", "[railpack] done"]
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      fakeBunProcess({ stdoutLines: lines }) as ReturnType<typeof Bun.spawn>
    )

    const captured: string[] = []
    await railpackMod.railpackBuild({
      workspacePath: tmpDir,
      tag: "127.0.0.1:5000/app-abc:sha",
      onLog: (line) => captured.push(line),
    })

    for (const line of lines) {
      expect(captured).toContain(line)
    }
  })

  it("throws when railpack exits non-zero", async () => {
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      fakeBunProcess({
        stderrLines: ["error: unsupported language"],
        exitCode: 1,
      }) as ReturnType<typeof Bun.spawn>
    )

    await expect(
      railpackMod.railpackBuild({
        workspacePath: tmpDir,
        tag: "127.0.0.1:5000/app-fail:sha",
      })
    ).rejects.toThrow(/railpack build failed \(exit 1\)/)
  })
})
