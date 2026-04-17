// SPDX-License-Identifier: AGPL-3.0-only
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CloneOptions {
  repoCloneUrl: string;
  buildDir: string;
  appId: string;
  buildId: string;
  branch: string;
  /** Number of commits to shallow-clone. Default: 1. */
  depth?: number;
  /** Timeout in milliseconds before killing git. Default: 60_000. */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Scrub a token embedded in a clone URL so it never leaks in error messages. */
function scrubToken(url: string): string {
  return url.replace(/(https?:\/\/)[^:]+:[^@]+@/, "$1x-access-token:***@");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Shallow-clone `repoCloneUrl` into `<buildDir>/<appId>/<buildId>`.
 * Throws if git exits with a non-zero code or the process times out.
 * The token in the clone URL is scrubbed from all error messages.
 */
export async function cloneRepo(
  opts: CloneOptions,
): Promise<{ workspacePath: string; headSha: string | null }> {
  const dest = path.join(opts.buildDir, opts.appId, opts.buildId);
  await mkdir(dest, { recursive: true });

  const args = [
    "clone",
    "--depth",
    String(opts.depth ?? 1),
    "--branch",
    opts.branch,
    "--single-branch",
    opts.repoCloneUrl,
    dest,
  ];

  const proc = Bun.spawn(["git", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, opts.timeoutMs ?? 60_000);

  const exitCode = await proc.exited;
  clearTimeout(timeout);

  if (timedOut) {
    throw new Error(`git clone timed out after ${opts.timeoutMs ?? 60_000}ms for ${scrubToken(opts.repoCloneUrl)}`);
  }

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(
      `git clone failed (${exitCode}) for ${scrubToken(opts.repoCloneUrl)}: ${scrubToken(stderr)}`,
    );
  }

  const headSha = await resolveHeadSha(dest);
  return { workspacePath: dest, headSha };
}

async function resolveHeadSha(workspace: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", "-C", workspace, "rev-parse", "HEAD"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exit = await proc.exited;
    if (exit !== 0) return null;
    const text = await new Response(proc.stdout).text();
    const sha = text.trim();
    return sha.length === 40 ? sha : null;
  } catch {
    return null;
  }
}

/**
 * Remove the workspace directory for a given app+build combination.
 * Silently succeeds if the directory does not exist.
 */
export async function cleanupWorkspace(
  appId: string,
  buildId: string,
  buildDir: string,
): Promise<void> {
  await rm(path.join(buildDir, appId, buildId), { recursive: true, force: true });
}
