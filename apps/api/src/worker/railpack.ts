// SPDX-License-Identifier: AGPL-3.0-only
import { chmod, mkdir } from "node:fs/promises"
import { existsSync, mkdirSync } from "node:fs"
import path from "node:path"
import os from "node:os"

// ---------------------------------------------------------------------------
// Binary resolution
// ---------------------------------------------------------------------------

/**
 * Ensure the `railpack` binary is available.
 *
 * Railpack is the successor to Nixpacks maintained by Railway since 2024
 * (railwayapp/railpack, written in Go, uses Caddy instead of nginx for PHP).
 * Dokploy supports it alongside Nixpacks (docs.dokploy.com/build-type).
 *
 * Resolution order, mirroring `nixpacks.ts` for consistency:
 *   1. `railpack` already on PATH (prod / CI image).
 *   2. `~/.ploydok-dev/bin/railpack` (dev cache).
 *   3. Download latest release from GitHub.
 */
export async function ensureRailpackInstalled(): Promise<string> {
  const which = Bun.spawn(["which", "railpack"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  await which.exited
  if (which.exitCode === 0) {
    return (await new Response(which.stdout).text()).trim()
  }

  const binDir = path.join(os.homedir(), ".ploydok-dev", "bin")
  const binPath = path.join(binDir, "railpack")
  if (existsSync(binPath)) return binPath

  await mkdir(binDir, { recursive: true })

  // Railpack release assets follow: railpack-v{tag}-linux-{arch}.tar.gz
  // Arch values upstream: amd64 (not x86_64) / arm64.
  const arch = process.arch === "x64" ? "amd64" : "arm64"

  const metaRes = await fetch(
    "https://api.github.com/repos/railwayapp/railpack/releases/latest",
    {
      headers: {
        "User-Agent": "ploydok",
        Accept: "application/vnd.github+json",
      },
    }
  )
  if (!metaRes.ok) {
    throw new Error(`railpack release lookup failed (${metaRes.status})`)
  }
  const meta = (await metaRes.json()) as { tag_name?: string }
  const tag = meta.tag_name
  if (!tag) {
    throw new Error("railpack release lookup returned no tag_name")
  }

  const tarName = `railpack-${tag}-linux-${arch}.tar.gz`
  const url = `https://github.com/railwayapp/railpack/releases/download/${tag}/${tarName}`

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`railpack download failed (${res.status}): ${url}`)
  }

  const tmpTar = path.join(binDir, tarName)
  const buf = await res.arrayBuffer()
  await Bun.write(tmpTar, buf)

  const tar = Bun.spawn(["tar", "-xzf", tmpTar, "-C", binDir], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const tarCode = await tar.exited
  if (tarCode !== 0) {
    const stderr = await new Response(tar.stderr).text()
    throw new Error(`railpack tar extraction failed (${tarCode}): ${stderr}`)
  }

  await chmod(binPath, 0o755)
  return binPath
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export interface RailpackBuildOptions {
  workspacePath: string
  /** Sub-directory within the workspace to build. Default: '.'. */
  rootDir?: string
  /** Docker image tag to produce (e.g. `registry/name:sha`). */
  tag: string
  /**
   * Local directory where Railpack may store build-layer cache.
   * Created automatically if it doesn't exist.
   */
  cacheDir?: string
  buildEnv?: Record<string, string>
  /** Called for every stdout/stderr line emitted by railpack. */
  onLog?: (line: string) => void
}

/**
 * Run `railpack build` for the given workspace.
 * Streams stdout/stderr through `opts.onLog`.
 * Throws on non-zero exit.
 *
 * Reference: railpack CLI docs (docs.railway.com/builds/railpack).
 */
export async function railpackBuild(opts: RailpackBuildOptions): Promise<void> {
  const bin = await ensureRailpackInstalled()
  const ctx = path.join(opts.workspacePath, opts.rootDir ?? ".")

  if (opts.cacheDir) {
    mkdirSync(opts.cacheDir, { recursive: true })
  }

  const args = ["build", ctx, "--name", opts.tag]

  const effectiveBuildEnv: Record<string, string> = {
    ...(opts.buildEnv ?? {}),
  }

  for (const [key, value] of Object.entries(effectiveBuildEnv)) {
    args.push("--env", `${key}=${value}`)
  }

  const proc = Bun.spawn([bin, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...effectiveBuildEnv },
  })

  async function pipeLogs(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader()
    const dec = new TextDecoder()
    let buf = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let i: number
      while ((i = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        opts.onLog?.(line)
      }
    }
    if (buf) opts.onLog?.(buf)
  }

  await Promise.all([
    pipeLogs(proc.stdout as ReadableStream<Uint8Array>),
    pipeLogs(proc.stderr as ReadableStream<Uint8Array>),
  ])

  const code = await proc.exited
  if (code !== 0) {
    throw new Error(`railpack build failed (exit ${code}) for tag ${opts.tag}`)
  }
}
