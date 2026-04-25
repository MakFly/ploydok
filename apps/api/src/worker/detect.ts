// SPDX-License-Identifier: AGPL-3.0-only
import { stat } from "node:fs/promises"
import path from "node:path"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DetectedMethod = {
  method: "docker" | "nixpacks" | "railpack"
  dockerfilePath?: string
}

export interface DetectOptions {
  workspacePath: string
  /** Sub-directory within the workspace to look in. Default: '.'. */
  rootDir?: string
  /** Force a build method (skip auto-detection). */
  override?: "docker" | "nixpacks" | "railpack" | "auto"
  /** Dockerfile path relative to rootDir. Default: 'Dockerfile'. */
  dockerfilePath?: string
  /** Railpack config path relative to rootDir. Default: 'railpack.json'. */
  railpackConfigPath?: string
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect whether the project should be built with Docker, Railpack, or Nixpacks.
 *
 * Priority:
 *  1. Explicit `override` (docker | nixpacks | railpack).
 *  2. Dockerfile present at `<rootDir>/<dockerfilePath>` → docker (most explicit
 *     dev signal: "I took control, build exactly this").
 *  3. railpack.json present at `<rootDir>` → railpack (explicit Railway-style
 *     config; without it Railpack and Nixpacks overlap on the same languages,
 *     so this file is the only clean discriminator).
 *  4. Fallback → nixpacks (universal default, broadest language coverage).
 */
export async function detectBuildMethod(
  opts: DetectOptions
): Promise<DetectedMethod> {
  const dockerfile = opts.dockerfilePath ?? "Dockerfile"
  const railpackConfig = opts.railpackConfigPath ?? "railpack.json"

  if (opts.override === "docker") {
    return { method: "docker", dockerfilePath: dockerfile }
  }
  if (opts.override === "nixpacks") {
    return { method: "nixpacks" }
  }
  if (opts.override === "railpack") {
    return { method: "railpack" }
  }

  const root = path.join(opts.workspacePath, opts.rootDir ?? ".")

  try {
    await stat(path.join(root, dockerfile))
    return { method: "docker", dockerfilePath: dockerfile }
  } catch {
    // not found, continue
  }

  try {
    await stat(path.join(root, railpackConfig))
    return { method: "railpack" }
  } catch {
    // not found, continue
  }

  return { method: "nixpacks" }
}
