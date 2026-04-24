// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Unit tests for nixpacksBuild().
 *
 * The `nixpacks` binary is not available in the test environment.
 * We mock `ensureNixpacksInstalled` to return a fake path and spy on
 * `Bun.spawn` to verify command construction, log streaming, cache flag
 * injection, and error handling without running an actual build.
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import os from "node:os"
import * as nixpacksMod from "./nixpacks"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fake Bun.spawn process that yields the given lines and exits. */
function fakeBunProcess(opts: {
  stdoutLines?: string[]
  stderrLines?: string[]
  exitCode?: number
}) {
  const stdoutText =
    (opts.stdoutLines ?? []).join("\n") +
    (opts.stdoutLines?.length ? "\n" : "")
  const stderrText =
    (opts.stderrLines ?? []).join("\n") +
    (opts.stderrLines?.length ? "\n" : "")
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("nixpacksBuild", () => {
  let tmpDir: string
  let spawnSpy: ReturnType<typeof spyOn>
  let ensureSpy: ReturnType<typeof spyOn>

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "ploydok-nixpacks-test-"))
    // Stub binary resolution so tests don't hit the network or filesystem.
    ensureSpy = spyOn(
      nixpacksMod,
      "ensureNixpacksInstalled",
    ).mockResolvedValue("/usr/local/bin/nixpacks")
  })

  afterEach(async () => {
    spawnSpy?.mockRestore?.()
    ensureSpy?.mockRestore?.()
    await rm(tmpDir, { recursive: true, force: true })
  })

  it("calls nixpacks with --cache-key when cacheKey is provided", async () => {
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      fakeBunProcess({
        stdoutLines: ["[nixpacks] Building..."],
      }) as ReturnType<typeof Bun.spawn>,
    )

    await nixpacksMod.nixpacksBuild({
      workspacePath: tmpDir,
      tag: "127.0.0.1:5000/app-abc:sha123",
      cacheKey: "app-abc",
      cacheDir: path.join(tmpDir, ".nixpacks-cache"),
    })

    const spawnMock = spawnSpy as unknown as {
      mock: { calls: Array<[unknown[], unknown]> }
    }
    expect(spawnMock.mock.calls.length).toBeGreaterThanOrEqual(1)
    const buildCall = spawnMock.mock.calls[0]
    const cmd = buildCall![0] as string[]
    expect(cmd).toContain("build")
    expect(cmd).toContain("--cache-key")
    const cacheKeyIdx = cmd.indexOf("--cache-key")
    expect(cmd[cacheKeyIdx + 1]).toBe("app-abc")
  })

  it("creates cacheDir before spawning", async () => {
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      fakeBunProcess({}) as ReturnType<typeof Bun.spawn>,
    )

    const cacheDir = path.join(tmpDir, "nested", ".nixpacks-cache")

    await nixpacksMod.nixpacksBuild({
      workspacePath: tmpDir,
      tag: "127.0.0.1:5000/app-abc:sha123",
      cacheKey: "app-abc",
      cacheDir,
    })

    expect(existsSync(cacheDir)).toBe(true)
  })

  it("falls back to basename of cacheDir as cache key when cacheKey is omitted", async () => {
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      fakeBunProcess({}) as ReturnType<typeof Bun.spawn>,
    )

    const cacheDir = path.join(tmpDir, "my-app-id")

    await nixpacksMod.nixpacksBuild({
      workspacePath: tmpDir,
      tag: "127.0.0.1:5000/app-abc:sha123",
      cacheDir,
    })

    const spawnMock = spawnSpy as unknown as {
      mock: { calls: Array<[unknown[], unknown]> }
    }
    const buildCall = spawnMock.mock.calls[0]
    const cmd = buildCall![0] as string[]
    const cacheKeyIdx = cmd.indexOf("--cache-key")
    // Fallback: use path.basename(cacheDir) as the stable key.
    expect(cmd[cacheKeyIdx + 1]).toBe("my-app-id")
  })

  it("does NOT pass --cache-key when neither cacheDir nor cacheKey is given", async () => {
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      fakeBunProcess({}) as ReturnType<typeof Bun.spawn>,
    )

    await nixpacksMod.nixpacksBuild({
      workspacePath: tmpDir,
      tag: "127.0.0.1:5000/app-abc:sha123",
    })

    const spawnMock = spawnSpy as unknown as {
      mock: { calls: Array<[unknown[], unknown]> }
    }
    const buildCall = spawnMock.mock.calls[0]
    const cmd = buildCall![0] as string[]
    expect(cmd).not.toContain("--cache-key")
  })

  it("streams stdout and stderr via onLog", async () => {
    const lines = ["Step 1: install", "Step 2: build", "Step 3: done"]
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      fakeBunProcess({ stdoutLines: lines }) as ReturnType<typeof Bun.spawn>,
    )

    const captured: string[] = []

    await nixpacksMod.nixpacksBuild({
      workspacePath: tmpDir,
      tag: "127.0.0.1:5000/app-abc:sha123",
      onLog: (line) => captured.push(line),
    })

    for (const line of lines) {
      expect(captured).toContain(line)
    }
  })

  it("throws when nixpacks exits with non-zero code", async () => {
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      fakeBunProcess({
        stderrLines: ["Error: failed to build — unknown plan"],
        exitCode: 1,
      }) as ReturnType<typeof Bun.spawn>,
    )

    await expect(
      nixpacksMod.nixpacksBuild({
        workspacePath: tmpDir,
        tag: "127.0.0.1:5000/app-fail:sha",
        cacheKey: "app-fail",
        cacheDir: path.join(tmpDir, ".nixpacks-cache"),
      }),
    ).rejects.toThrow(/nixpacks build failed \(exit 1\)/)
  })

  it("injects --incremental-cache-image when dockerCacheRef + cacheDir are provided", async () => {
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      fakeBunProcess({}) as ReturnType<typeof Bun.spawn>,
    )

    const cacheDir = path.join(tmpDir, ".nixpacks-cache")
    const dockerCacheRef = "127.0.0.1:5000/app-abc:cache"

    await nixpacksMod.nixpacksBuild({
      workspacePath: tmpDir,
      tag: "127.0.0.1:5000/app-abc:sha123",
      cacheKey: "app-abc",
      cacheDir,
      dockerCacheRef,
    })

    const spawnMock = spawnSpy as unknown as {
      mock: { calls: Array<[unknown[], unknown]> }
    }
    const buildCall = spawnMock.mock.calls[0]
    const cmd = buildCall![0] as string[]

    const flag = cmd.find((a) => a.startsWith("--incremental-cache-image="))
    expect(flag).toBe(`--incremental-cache-image=${dockerCacheRef}`)
  })

  it("does NOT inject --incremental-cache-image when dockerCacheRef is absent", async () => {
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      fakeBunProcess({}) as ReturnType<typeof Bun.spawn>,
    )

    await nixpacksMod.nixpacksBuild({
      workspacePath: tmpDir,
      tag: "127.0.0.1:5000/app-abc:sha123",
      cacheKey: "app-abc",
      cacheDir: path.join(tmpDir, ".nixpacks-cache"),
    })

    const spawnMock = spawnSpy as unknown as {
      mock: { calls: Array<[unknown[], unknown]> }
    }
    const buildCall = spawnMock.mock.calls[0]
    const cmd = buildCall![0] as string[]
    expect(cmd.some((a) => a.startsWith("--incremental-cache-image="))).toBe(false)
  })

  it("does NOT inject --incremental-cache-image when cacheDir is absent", async () => {
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      fakeBunProcess({}) as ReturnType<typeof Bun.spawn>,
    )

    await nixpacksMod.nixpacksBuild({
      workspacePath: tmpDir,
      tag: "127.0.0.1:5000/app-abc:sha123",
      cacheKey: "app-abc",
      dockerCacheRef: "127.0.0.1:5000/app-abc:cache",
    })

    const spawnMock = spawnSpy as unknown as {
      mock: { calls: Array<[unknown[], unknown]> }
    }
    const buildCall = spawnMock.mock.calls[0]
    const cmd = buildCall![0] as string[]
    expect(cmd.some((a) => a.startsWith("--incremental-cache-image="))).toBe(false)
  })

  it("passes optional installCmd, buildCmd, startCmd flags", async () => {
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      fakeBunProcess({}) as ReturnType<typeof Bun.spawn>,
    )

    await nixpacksMod.nixpacksBuild({
      workspacePath: tmpDir,
      tag: "127.0.0.1:5000/app-abc:sha123",
      installCmd: "bun install",
      buildCmd: "bun run build",
      startCmd: "bun run start",
    })

    const spawnMock = spawnSpy as unknown as {
      mock: { calls: Array<[unknown[], unknown]> }
    }
    const buildCall = spawnMock.mock.calls[0]
    const cmd = buildCall![0] as string[]
    expect(cmd).toContain("--install-cmd")
    expect(cmd).toContain("bun install")
    expect(cmd).toContain("--build-cmd")
    expect(cmd).toContain("bun run build")
    expect(cmd).toContain("--start-cmd")
    expect(cmd).toContain("bun run start")
  })

  it("passes config path, node version env, and build env", async () => {
    let spawnEnv: Record<string, string> | undefined
    spawnSpy = spyOn(Bun, "spawn").mockImplementation(((...args: unknown[]) => {
      const opts = (args.length === 1 ? args[0] : args[1]) as { env?: Record<string, string> } | undefined
      spawnEnv = opts?.env
      return fakeBunProcess({}) as ReturnType<typeof Bun.spawn>
    }) as typeof Bun.spawn)

    await nixpacksMod.nixpacksBuild({
      workspacePath: tmpDir,
      tag: "127.0.0.1:5000/app-abc:sha123",
      configFile: "nixpacks.toml",
      nodeVersion: "22",
      buildEnv: { NEXT_PUBLIC_API_URL: "https://api.example.com" },
    })

    const spawnMock = spawnSpy as unknown as {
      mock: { calls: Array<[unknown[], unknown]> }
    }
    const buildCall = spawnMock.mock.calls[0]
    const cmd = buildCall![0] as string[]
    expect(cmd).toContain("--config")
    expect(cmd).toContain(path.join(tmpDir, "nixpacks.toml"))
    expect(spawnEnv?.["NIXPACKS_NODE_VERSION"]).toBe("22")
    expect(spawnEnv?.["NEXT_PUBLIC_API_URL"]).toBe("https://api.example.com")
    // buildEnv values must also reach the Dockerfile via `--env K=V`.
    expect(cmd).toContain("NEXT_PUBLIC_API_URL=https://api.example.com")
  })

  it("injects NPM_CONFIG_LEGACY_PEER_DEPS=true into build env by default", async () => {
    let spawnEnv: Record<string, string> | undefined
    spawnSpy = spyOn(Bun, "spawn").mockImplementation(((...args: unknown[]) => {
      const opts = (args.length === 1 ? args[0] : args[1]) as { env?: Record<string, string> } | undefined
      spawnEnv = opts?.env
      return fakeBunProcess({}) as ReturnType<typeof Bun.spawn>
    }) as typeof Bun.spawn)

    await nixpacksMod.nixpacksBuild({
      workspacePath: tmpDir,
      tag: "127.0.0.1:5000/app-abc:sha123",
    })

    const spawnMock = spawnSpy as unknown as {
      mock: { calls: Array<[unknown[], unknown]> }
    }
    const buildCall = spawnMock.mock.calls[0]
    const cmd = buildCall![0] as string[]
    expect(spawnEnv?.["NPM_CONFIG_LEGACY_PEER_DEPS"]).toBe("true")
    expect(cmd).toContain("--env")
    expect(cmd).toContain("NPM_CONFIG_LEGACY_PEER_DEPS=true")
  })

  it("allows buildEnv to override NPM_CONFIG_LEGACY_PEER_DEPS", async () => {
    let spawnEnv: Record<string, string> | undefined
    spawnSpy = spyOn(Bun, "spawn").mockImplementation(((...args: unknown[]) => {
      const opts = (args.length === 1 ? args[0] : args[1]) as { env?: Record<string, string> } | undefined
      spawnEnv = opts?.env
      return fakeBunProcess({}) as ReturnType<typeof Bun.spawn>
    }) as typeof Bun.spawn)

    await nixpacksMod.nixpacksBuild({
      workspacePath: tmpDir,
      tag: "127.0.0.1:5000/app-abc:sha123",
      buildEnv: { NPM_CONFIG_LEGACY_PEER_DEPS: "false" },
    })

    expect(spawnEnv?.["NPM_CONFIG_LEGACY_PEER_DEPS"]).toBe("false")
  })
})
