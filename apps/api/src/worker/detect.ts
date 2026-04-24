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
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect whether the project should be built with Docker or Nixpacks.
 *
 * Priority:
 *  1. Explicit `override` of 'docker' or 'nixpacks'.
 *  2. Auto-detect: if a Dockerfile is found in `<workspacePath>/<rootDir>`,
 *     use Docker; otherwise fall back to Nixpacks.
 */
export async function detectBuildMethod(
  opts: DetectOptions
): Promise<DetectedMethod> {
  const dockerfile = opts.dockerfilePath ?? "Dockerfile"

  // Explicit override wins.
  if (opts.override === "docker") {
    return { method: "docker", dockerfilePath: dockerfile }
  }
  if (opts.override === "nixpacks") {
    return { method: "nixpacks" }
  }
  if (opts.override === "railpack") {
    return { method: "railpack" }
  }

  // Auto-detect: look for a Dockerfile in the root dir.
  const root = path.join(opts.workspacePath, opts.rootDir ?? ".")
  try {
    await stat(path.join(root, dockerfile))
    return { method: "docker", dockerfilePath: dockerfile }
  } catch {
    return { method: "nixpacks" }
  }
}
