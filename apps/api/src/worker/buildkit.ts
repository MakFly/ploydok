// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BuildKit rootless wrapper.
 *
 * Invokes `buildctl` to build a Dockerfile and push the image to a registry.
 * Streams stderr line-by-line via the `onLog` callback.
 */
import path from "node:path";
import os from "node:os";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { env } from "../env";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuildImageOptions {
  /** Absolute path to the build context directory. */
  contextDir: string;
  /** Absolute path to the Dockerfile (must reside within contextDir). */
  dockerfile: string;
  /** Full image reference including tag, e.g. `127.0.0.1:5000/app-abc123:sha`. */
  imageRef: string;
  /**
   * Directory used for BuildKit layer cache (--import-cache / --export-cache).
   * Created automatically if missing.
   */
  cacheDir: string;
  /** Build args forwarded to the Dockerfile frontend. */
  buildArgs?: Record<string, string>;
  /**
   * Build secrets mounted via BuildKit `RUN --mount=type=secret,id=...`.
   * The same values are also exposed as build args by the caller when needed.
   */
  buildSecrets?: Record<string, string>;
  /** Called for every log line emitted by buildctl on stdout/stderr. */
  onLog?: (line: string) => void;
}

export interface BuildImageResult {
  /** OCI image digest, e.g. `sha256:…`. Parsed from buildctl output. */
  imageDigest: string;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a Docker image with BuildKit rootless and push it to the configured
 * local registry.
 *
 * Uses `buildctl` on PATH (installed inside the `moby/buildkit` image or the
 * host if buildkit-rootless is in use without a socket proxy).
 *
 * BuildKit socket: `PLOYDOK_BUILDKIT_ADDR` env var (default:
 * `docker-container://ploydok-buildkitd`).
 */
export async function buildImage(opts: BuildImageOptions): Promise<BuildImageResult> {
  await mkdir(opts.cacheDir, { recursive: true });

  const addr = env.PLOYDOK_BUILDKIT_ADDR;

  // Resolve the Dockerfile directory (passed as --local dockerfile=<dir>).
  const dockerfileDir = path.dirname(opts.dockerfile);
  const dockerfileName = path.basename(opts.dockerfile);

  const args = [
    "--addr", addr,
    "build",
    "--frontend", "dockerfile.v0",
    "--opt", `filename=${dockerfileName}`,
    "--local", `context=${opts.contextDir}`,
    "--local", `dockerfile=${dockerfileDir}`,
    "--output", `type=image,name=${opts.imageRef},push=true`,
    "--export-cache", `type=local,dest=${opts.cacheDir},mode=max`,
    "--import-cache", `type=local,src=${opts.cacheDir}`,
    "--progress", "plain",
  ];

  for (const [key, value] of Object.entries(opts.buildArgs ?? {})) {
    args.push("--opt", `build-arg:${key}=${value}`);
  }

  let secretDir: string | null = null;
  try {
    if (opts.buildSecrets && Object.keys(opts.buildSecrets).length > 0) {
      secretDir = await mkdtemp(path.join(os.tmpdir(), "ploydok-buildkit-secrets-"));
      for (const [key, value] of Object.entries(opts.buildSecrets)) {
        const secretPath = path.join(secretDir, key);
        await writeFile(secretPath, value, { mode: 0o600 });
        args.push("--secret", `id=${key},src=${secretPath}`);
      }
    }

    const startMs = Date.now();

    const proc = Bun.spawn(["buildctl", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });

  // Collect digest from output while streaming logs.
    let imageDigest = "";

    async function pipeLines(stream: ReadableStream<Uint8Array>): Promise<void> {
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
          // Try to parse the pushed digest from buildctl output.
          const digestMatch = line.match(/sha256:[a-f0-9]{64}/);
          if (digestMatch && !imageDigest) {
            imageDigest = digestMatch[0];
          }
          opts.onLog?.(line);
        }
      }
      // Flush remaining content without trailing newline.
      if (buf) {
        const digestMatch = buf.match(/sha256:[a-f0-9]{64}/);
        if (digestMatch && !imageDigest) imageDigest = digestMatch[0];
        opts.onLog?.(buf);
      }
    }

    await Promise.all([
      pipeLines(proc.stdout as ReadableStream<Uint8Array>),
      pipeLines(proc.stderr as ReadableStream<Uint8Array>),
    ]);

    const code = await proc.exited;
    const durationMs = Date.now() - startMs;

    if (code !== 0) {
      throw new Error(
        `buildctl failed (exit ${code}) for image ${opts.imageRef}`,
      );
    }

    // If we couldn't parse the digest from output, fall back to a placeholder
    // so callers can still proceed — the image was pushed successfully.
    if (!imageDigest) {
      imageDigest = "sha256:unknown";
    }

    return { imageDigest, durationMs };
  } finally {
    if (secretDir) {
      await rm(secretDir, { recursive: true, force: true });
    }
  }
}
