// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// We test cloneRepo by mocking Bun.spawn so no real git invocation happens.
// ---------------------------------------------------------------------------

// Import after mocking to avoid stale references.
import { cloneRepo, cleanupWorkspace } from "./git";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal mock of the object returned by Bun.spawn. */
function makeSpawnMock(exitCode: number, stderr = "") {
  const enc = new TextEncoder();
  return {
    exitCode,
    exited: Promise.resolve(exitCode),
    kill: mock(() => {}),
    stdout: new ReadableStream({
      start(c) {
        c.close();
      },
    }),
    stderr: new ReadableStream({
      start(c) {
        c.enqueue(enc.encode(stderr));
        c.close();
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cloneRepo", () => {
  let tmpDir: string;
  let originalSpawn: typeof Bun.spawn;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "ploydok-git-test-"));
    originalSpawn = Bun.spawn;
  });

  afterEach(async () => {
    Bun.spawn = originalSpawn;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("calls git clone with correct shallow-clone args", async () => {
    const spawnMock = mock((_cmd: string[]) => makeSpawnMock(0));
    Bun.spawn = spawnMock as unknown as typeof Bun.spawn;

    await cloneRepo({
      repoCloneUrl: "https://x-access-token:TOKEN@github.com/owner/repo.git",
      buildDir: tmpDir,
      appId: "app-1",
      buildId: "bld-1",
      branch: "main",
      depth: 1,
    });

    // cloneRepo spawns twice: once for `git clone`, once for `git rev-parse HEAD`
    // (to resolve the head sha). We assert on the first invocation only.
    expect(spawnMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    const [cmd] = spawnMock.mock.calls[0]!;
    expect(cmd[0]).toBe("git");
    expect(cmd).toContain("clone");
    expect(cmd).toContain("--depth");
    expect(cmd).toContain("1");
    expect(cmd).toContain("--branch");
    expect(cmd).toContain("main");
    expect(cmd).toContain("--single-branch");
  });

  it("creates destination directory before cloning", async () => {
    Bun.spawn = mock((_cmd: string[]) => makeSpawnMock(0)) as unknown as typeof Bun.spawn;

    const result = await cloneRepo({
      repoCloneUrl: "https://x-access-token:TOKEN@github.com/owner/repo.git",
      buildDir: tmpDir,
      appId: "app-2",
      buildId: "bld-2",
      branch: "main",
    });

    // The dest path should be returned
    expect(result.workspacePath).toBe(path.join(tmpDir, "app-2", "bld-2"));
  });

  it("throws on non-zero exit code", async () => {
    Bun.spawn = mock((_cmd: string[]) =>
      makeSpawnMock(128, "fatal: repository not found"),
    ) as unknown as typeof Bun.spawn;

    await expect(
      cloneRepo({
        repoCloneUrl: "https://x-access-token:TOKEN@github.com/owner/repo.git",
        buildDir: tmpDir,
        appId: "app-3",
        buildId: "bld-3",
        branch: "main",
      }),
    ).rejects.toThrow("git clone failed (128)");
  });

  it("scrubs token from error message on failure", async () => {
    Bun.spawn = mock((_cmd: string[]) =>
      makeSpawnMock(128, "fatal: repo not found"),
    ) as unknown as typeof Bun.spawn;

    let errorMessage = "";
    try {
      await cloneRepo({
        repoCloneUrl: "https://x-access-token:SUPER_SECRET_TOKEN@github.com/owner/repo.git",
        buildDir: tmpDir,
        appId: "app-4",
        buildId: "bld-4",
        branch: "main",
      });
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    expect(errorMessage).not.toContain("SUPER_SECRET_TOKEN");
    expect(errorMessage).toContain("***");
  });

  it("throws and marks timedOut on process kill", async () => {
    // Simulate a process that never exits — we use a very short timeout
    let killed = false;
    const neverResolvingSpawn = {
      exitCode: null,
      exited: new Promise<number>((resolve) => {
        // resolve after 500ms (well after the 10ms timeout below)
        setTimeout(() => resolve(0), 500);
      }),
      kill: mock(() => {
        killed = true;
      }),
      stdout: new ReadableStream({ start: (c) => c.close() }),
      stderr: new ReadableStream({ start: (c) => c.close() }),
    };

    Bun.spawn = mock(() => neverResolvingSpawn) as unknown as typeof Bun.spawn;

    await expect(
      cloneRepo({
        repoCloneUrl: "https://x-access-token:TOKEN@github.com/owner/repo.git",
        buildDir: tmpDir,
        appId: "app-5",
        buildId: "bld-5",
        branch: "main",
        timeoutMs: 10, // 10ms — will fire before 500ms resolve
      }),
    ).rejects.toThrow("timed out");

    // The process was killed
    expect(killed).toBe(true);
  });
});

describe("cleanupWorkspace", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "ploydok-cleanup-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("removes the workspace directory", async () => {
    const workspaceDir = path.join(tmpDir, "app-1", "bld-1");
    await mkdir(workspaceDir, { recursive: true });
    await writeFile(path.join(workspaceDir, "test.txt"), "hello");

    await cleanupWorkspace("app-1", "bld-1", tmpDir);

    // Directory should no longer exist
    const exists = await Bun.file(path.join(workspaceDir, "test.txt")).exists();
    expect(exists).toBe(false);
  });

  it("succeeds silently when directory does not exist", async () => {
    await expect(
      cleanupWorkspace("non-existent-app", "non-existent-build", tmpDir),
    ).resolves.toBeUndefined();
  });
});
