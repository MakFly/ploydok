// SPDX-License-Identifier: AGPL-3.0-only
import { mkdir, chmod } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// Binary resolution
// ---------------------------------------------------------------------------

/**
 * Ensure the `nixpacks` binary is available.
 *
 * Resolution order:
 *  1. Check if `nixpacks` is already on PATH (typical in prod / CI).
 *  2. Check `~/.ploydok-dev/bin/nixpacks` (already downloaded).
 *  3. Download the latest release binary from GitHub.
 *
 * Returns the absolute path to the binary.
 */
export async function ensureNixpacksInstalled(): Promise<string> {
  // 1. Check PATH
  const which = Bun.spawn(["which", "nixpacks"], { stdout: "pipe", stderr: "pipe" });
  await which.exited;
  if (which.exitCode === 0) {
    return (await new Response(which.stdout).text()).trim();
  }

  // 2. Check local dev cache
  const binDir = path.join(os.homedir(), ".ploydok-dev", "bin");
  const binPath = path.join(binDir, "nixpacks");
  if (existsSync(binPath)) return binPath;

  // 3. Download from GitHub releases
  await mkdir(binDir, { recursive: true });

  const arch = process.arch === "x64" ? "x86_64" : "aarch64";
  const tarName = `nixpacks-${arch}-unknown-linux-musl.tar.gz`;
  const url = `https://github.com/railwayapp/nixpacks/releases/latest/download/${tarName}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`nixpacks download failed (${res.status}): ${url}`);
  }

  // Write tar.gz to a temp file, extract, and move the binary.
  const tmpTar = path.join(binDir, tarName);
  const buf = await res.arrayBuffer();
  await Bun.write(tmpTar, buf);

  // Extract with `tar` — available on any Linux/macOS host.
  const tar = Bun.spawn(["tar", "-xzf", tmpTar, "-C", binDir], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const tarCode = await tar.exited;
  if (tarCode !== 0) {
    const stderr = await new Response(tar.stderr).text();
    throw new Error(`nixpacks tar extraction failed (${tarCode}): ${stderr}`);
  }

  // The archive contains a single `nixpacks` binary at the root.
  await chmod(binPath, 0o755);
  return binPath;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export interface NixpacksBuildOptions {
  workspacePath: string;
  /** Sub-directory within the workspace to build. Default: '.'. */
  rootDir?: string;
  /** Docker image tag to produce (e.g. `registry/name:sha`). */
  tag: string;
  /**
   * Stable key used for `--cache-key` (typically the app ID).
   * Must not change between builds of the same app — do not use the image SHA.
   */
  cacheKey?: string;
  /**
   * Local directory where Nixpacks may store build-layer cache.
   * Created automatically if it doesn't exist.
   */
  cacheDir?: string;
  /**
   * Registry image reference used as a remote cache source **and** destination,
   * e.g. `127.0.0.1:5000/app-xyz:cache`.
   *
   * When provided together with `cacheDir`, two BuildKit cache flags are
   * injected into the nixpacks command:
   *   --docker-cache-from=<dockerCacheRef>
   *   --docker-cache-to=type=local,dest=<cacheDir>,mode=max
   *
   * Nixpacks delegates these flags verbatim to the underlying Docker buildx
   * backend, so they follow the standard BuildKit cache export/import syntax.
   */
  dockerCacheRef?: string;
  installCmd?: string;
  buildCmd?: string;
  startCmd?: string;
  /** Called for every stdout/stderr line emitted by nixpacks. */
  onLog?: (line: string) => void;
}

/**
 * Run `nixpacks build` for the given workspace.
 * Streams stdout and stderr through `opts.onLog` line by line.
 * Throws if the process exits with a non-zero code.
 */
export async function nixpacksBuild(opts: NixpacksBuildOptions): Promise<void> {
  const bin = await ensureNixpacksInstalled();
  const ctx = path.join(opts.workspacePath, opts.rootDir ?? ".");

  // Ensure the cache directory exists before spawning.
  if (opts.cacheDir) {
    mkdirSync(opts.cacheDir, { recursive: true });
  }

  const args = ["build", ctx, "--name", opts.tag];

  // Pass a stable cache key so Nixpacks can reuse layer cache across builds
  // of the same app.  We use `cacheKey` (the app ID) rather than `tag` because
  // the tag embeds the commit SHA and changes every build.
  if (opts.cacheDir && opts.cacheKey) {
    args.push("--cache-key", opts.cacheKey);
  } else if (opts.cacheDir) {
    // cacheDir provided without an explicit cacheKey — derive a stable key
    // from the cache directory name (last path segment = app ID in practice).
    args.push("--cache-key", path.basename(opts.cacheDir));
  }

  // Inject BuildKit-level cache flags when both a remote cache reference and a
  // local cache directory are provided.  Nixpacks forwards these flags verbatim
  // to the Docker buildx backend (--docker-cache-from / --docker-cache-to).
  if (opts.dockerCacheRef && opts.cacheDir) {
    args.push(`--docker-cache-from=${opts.dockerCacheRef}`);
    args.push(`--docker-cache-to=type=local,dest=${opts.cacheDir},mode=max`);
  }

  if (opts.installCmd) args.push("--install-cmd", opts.installCmd);
  if (opts.buildCmd) args.push("--build-cmd", opts.buildCmd);
  if (opts.startCmd) args.push("--start-cmd", opts.startCmd);

  const proc = Bun.spawn([bin, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  async function pipeLogs(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        opts.onLog?.(line);
      }
    }
    // Flush any remaining content without a trailing newline
    if (buf) opts.onLog?.(buf);
  }

  await Promise.all([
    pipeLogs(proc.stdout as ReadableStream<Uint8Array>),
    pipeLogs(proc.stderr as ReadableStream<Uint8Array>),
  ]);

  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`nixpacks build failed (exit ${code}) for tag ${opts.tag}`);
  }
}
