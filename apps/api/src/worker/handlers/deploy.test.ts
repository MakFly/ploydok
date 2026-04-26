// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Unit tests for handleDeploy.
 *
 * All external calls (DB, git, detect, nixpacks) are mocked.
 * We verify orchestration logic, build status transitions, and error paths.
 * Log archiving tests use a real tmpdir to assert file creation + content.
 */
import {
  describe,
  it,
  expect,
  mock,
  beforeEach,
  spyOn,
  afterAll,
} from "bun:test"
import fs from "node:fs"
import path from "node:path"

// ---------------------------------------------------------------------------
// Module-level mocks — must be set up before dynamic imports
// ---------------------------------------------------------------------------

import * as dbQueries from "@ploydok/db/queries"
import * as gitMod from "../git"
import * as detectMod from "../detect"
import * as nixpacksMod from "../nixpacks"
import * as runnerMod from "../runner"
import * as eventBusMod from "../event-bus"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal fake job object matching the shape expected by handleDeploy. */
function makeJob(
  payload: object,
  overrides: Partial<{ attempts: number; max_attempts: number }> = {}
) {
  return {
    id: "job-test-1",
    payload: JSON.stringify(payload),
    attempts: overrides.attempts ?? 1,
    max_attempts: overrides.max_attempts ?? 3,
  }
}

/** Minimal app row as returned by getAppForDeploy (internal to deploy.ts). */
const MOCK_APP = {
  id: "app-1",
  project_id: "proj-1",
  name: "test-app",
  slug: "test-app",
  status: "created",
  git_provider: "github",
  repo_full_name: "owner/repo",
  branch: "main",
  github_installation_id: null,
  root_dir: null,
  dockerfile_path: null,
  install_command: null,
  build_command: null,
  start_command: null,
  build_method: "auto",
  owner_id: "user-1",
}

/** Fake build row returned by insertBuild / updateBuildStatus. */
function fakeBuild(id: string, status: string) {
  return {
    id,
    app_id: MOCK_APP.id,
    status,
    build_method: null,
    image_tag: null,
    container_id: null,
    commit_sha: null,
    log_path: null,
    error_message: null,
    started_at: null,
    finished_at: null,
    created_at: new Date(),
  }
}

/** A fake Db object — only the shape matters; all queries are mocked. */
const fakeDb = {} as import("@ploydok/db").Db

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleDeploy", () => {
  beforeEach(() => {
    // Reset all spies before each test.
    mock.restore()
  })

  it("validates payload schema — throws on invalid JSON", async () => {
    const { handleDeploy } = await import("./deploy")
    const job = {
      id: "job-invalid",
      payload: "{invalid json}",
      attempts: 1,
      max_attempts: 3,
    }

    await expect(handleDeploy(fakeDb, job)).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Integration-style tests with a real Postgres DB (via makeTestDb)
// ---------------------------------------------------------------------------

import { apps, projects, users } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { eq } from "drizzle-orm"
import { makeTestDb, TEST_PG_URL } from "../../test/db-helpers"

const NOW = new Date()

const skipIntegration = !TEST_PG_URL
if (skipIntegration)
  console.log(
    "[deploy.test] PLOYDOK_TEST_PG_URL not set — skipping DB integration tests"
  )

describe.skipIf(skipIntegration)(
  "handleDeploy — integration stubs (real Postgres DB)",
  () => {
    it("creates a build record with status running then failed when no git config", async () => {
      const { db } = await makeTestDb()

      const { handleDeploy } = await import("./deploy")
      const job = makeJob({ appId: "non-existent-app" })

      await expect(handleDeploy(db, job)).rejects.toThrow("App not found")
    })
  }
)

// ---------------------------------------------------------------------------
// Log archiving tests — assert createWriteStream + write behaviour
// ---------------------------------------------------------------------------

import * as registryMod from "../registry"
import * as installTokensMod from "../../github/installation-tokens"
import { env } from "../../env"
import { listBuildsByApp } from "@ploydok/db/queries"

// App IDs used in log archiving tests — cleaned up after all tests.
const LOG_TEST_APP_IDS = ["app-log-1", "app-log-2"]

afterAll(() => {
  for (const appId of LOG_TEST_APP_IDS) {
    const dir = path.join(env.PLOYDOK_BUILD_DIR, appId)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe.skipIf(skipIntegration)("handleDeploy — log archiving", () => {
  beforeEach(() => {
    mock.restore()
    // Clean up any log files from previous runs of these test app IDs.
    for (const appId of LOG_TEST_APP_IDS) {
      const dir = path.join(env.PLOYDOK_BUILD_DIR, appId)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("creates a log file at the expected path and writes log lines to it", async () => {
    // Set up a real Postgres DB with fixtures.
    const { db } = await makeTestDb()

    // Insert fixtures: user → project → app
    await db.insert(users).values({
      id: "user-log-1",
      email: "log@test.com",
      display_name: "Log Tester",
      created_at: NOW,
      updated_at: NOW,
    })
    await db.insert(projects).values({
      id: "proj-log-1",
      owner_id: "user-log-1",
      name: "log-project",
      slug: "log-project",
      created_at: NOW,
    })
    await db.insert(apps).values({
      id: "app-log-1",
      project_id: "proj-log-1",
      name: "log-app",
      slug: "log-app",
      repo_full_name: "owner/repo",
      branch: "main",
    })

    // Mock external dependencies so the build runs to completion.
    spyOn(installTokensMod, "listAppInstallations").mockResolvedValue([
      { id: 42, accountLogin: "owner" },
    ] as any)
    spyOn(installTokensMod, "getInstallationToken").mockResolvedValue(
      "fake-token"
    )
    spyOn(gitMod, "cloneRepo").mockResolvedValue({
      workspacePath: path.join(env.PLOYDOK_BUILD_DIR, "ws-test"),
      headSha: null,
    })
    spyOn(detectMod, "detectBuildMethod").mockResolvedValue({
      method: "nixpacks",
    })
    spyOn(registryMod, "diskGuard").mockResolvedValue(undefined)
    spyOn(nixpacksMod, "nixpacksBuild").mockImplementation(
      async ({ onLog }) => {
        onLog?.("Step 1/3 : FROM node:22")
        onLog?.("Step 2/3 : COPY . .")
        onLog?.("Step 3/3 : RUN bun install")
      }
    )
    spyOn(registryMod, "gcKeepLast").mockResolvedValue([])
    // Mock runBlueGreen so the log archiving test doesn't need a running agent.
    spyOn(runnerMod, "runBlueGreen").mockResolvedValue({
      containerId: "cont-log-1",
      color: "blue",
    })

    const { handleDeploy } = await import("./deploy")
    const job = makeJob({
      appId: "app-log-1",
      commitMessage: "chore: log archiving test",
    })

    await handleDeploy(db, job)

    // Assert the log file was created at the expected path.
    const expectedLogDir = path.join(env.PLOYDOK_BUILD_DIR, "app-log-1")
    const logFiles = (fs.readdirSync(expectedLogDir) as string[]).filter((f) =>
      f.endsWith(".log")
    )
    expect(logFiles.length).toBe(1)

    const logFilePath = path.join(expectedLogDir, logFiles[0] as string)

    // Assert log lines were written to the file.
    const content = fs.readFileSync(logFilePath, "utf-8")
    expect(content).toContain("Step 1/3 : FROM node:22\n")
    expect(content).toContain("Step 2/3 : COPY . .\n")
    expect(content).toContain("Step 3/3 : RUN bun install\n")

    // Assert the build DB record has log_path set to the log file path.
    const builds = await listBuildsByApp(db, "app-log-1")
    const build = builds[0]
    expect(build?.log_path).toBe(logFilePath)
    expect(build?.status).toBe("succeeded")
    // build_method must be non-null (fix for build_method null bug).
    expect(build?.build_method).not.toBeNull()
    // commitMessage must be persisted from job payload.
    expect(build?.commit_message).toBe("chore: log archiving test")
  })

  it("still creates the log file even when the build fails", async () => {
    const { db } = await makeTestDb()

    await db.insert(users).values({
      id: "user-log-2",
      email: "fail@test.com",
      display_name: "Fail Tester",
      created_at: NOW,
      updated_at: NOW,
    })
    await db.insert(projects).values({
      id: "proj-log-2",
      owner_id: "user-log-2",
      name: "fail-project",
      slug: "fail-project",
      created_at: NOW,
    })
    await db.insert(apps).values({
      id: "app-log-2",
      project_id: "proj-log-2",
      name: "fail-app",
      slug: "fail-app",
      repo_full_name: "owner/repo",
      branch: "main",
    })

    spyOn(installTokensMod, "listAppInstallations").mockResolvedValue([
      { id: 42, accountLogin: "owner" },
    ] as any)
    spyOn(installTokensMod, "getInstallationToken").mockResolvedValue(
      "fake-token"
    )
    spyOn(gitMod, "cloneRepo").mockRejectedValue(
      new Error("git clone failed: timeout")
    )

    const { handleDeploy } = await import("./deploy")
    const job = makeJob({ appId: "app-log-2" })

    await expect(handleDeploy(db, job)).rejects.toThrow(
      "git clone failed: timeout"
    )

    // Log file must have been created (even on failure).
    const expectedLogDir = path.join(env.PLOYDOK_BUILD_DIR, "app-log-2")
    const logFiles = (fs.readdirSync(expectedLogDir) as string[]).filter((f) =>
      f.endsWith(".log")
    )
    expect(logFiles.length).toBe(1)

    // Build record must have log_path + failed status.
    const buildRows = await listBuildsByApp(db, "app-log-2")
    const build = buildRows[0]
    expect(build?.status).toBe("failed")

    const logFilePath = path.join(expectedLogDir, logFiles[0] as string)
    expect(build?.log_path).toBe(logFilePath)
  })
})

// ---------------------------------------------------------------------------
// Blue-green integration tests — assert step 4 orchestration
// ---------------------------------------------------------------------------

const LOG_TEST_APP_ID_BG = "app-bg-1"

afterAll(() => {
  const dir = path.join(env.PLOYDOK_BUILD_DIR, LOG_TEST_APP_ID_BG)
  fs.rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(skipIntegration)("handleDeploy — blue-green", () => {
  let db: Db

  beforeEach(async () => {
    mock.restore()

    // Fresh Postgres DB for each test.
    const result = await makeTestDb()
    db = result.db

    // Seed: user → project → app
    await db.insert(users).values({
      id: "user-bg-1",
      email: "bg@test.com",
      display_name: "BG Tester",
      created_at: NOW,
      updated_at: NOW,
    })
    await db.insert(projects).values({
      id: "proj-bg-1",
      owner_id: "user-bg-1",
      name: "bg-project",
      slug: "bg-project",
      created_at: NOW,
    })
    await db.insert(apps).values({
      id: LOG_TEST_APP_ID_BG,
      project_id: "proj-bg-1",
      name: "bg-app",
      slug: "bg-app",
      repo_full_name: "owner/repo",
      branch: "main",
    })

    // Stub common dependencies for a full successful build up to push.
    spyOn(installTokensMod, "listAppInstallations").mockResolvedValue([
      { id: 42, accountLogin: "owner" },
    ] as any)
    spyOn(installTokensMod, "getInstallationToken").mockResolvedValue(
      "fake-token"
    )
    spyOn(gitMod, "cloneRepo").mockResolvedValue({
      workspacePath: path.join(env.PLOYDOK_BUILD_DIR, "ws-bg"),
      headSha: null,
    })
    spyOn(detectMod, "detectBuildMethod").mockResolvedValue({
      method: "nixpacks",
    })
    spyOn(registryMod, "diskGuard").mockResolvedValue(undefined)
    spyOn(nixpacksMod, "nixpacksBuild").mockResolvedValue(undefined)
    spyOn(registryMod, "gcKeepLast").mockResolvedValue([])
  })

  it("calls runBlueGreen after push, updates build containerId, publishes Container live event", async () => {
    // Mock runBlueGreen to return a fake container.
    const runBlueGreenSpy = spyOn(runnerMod, "runBlueGreen").mockResolvedValue({
      containerId: "cont-123",
      color: "blue",
    })

    // Capture eventBus.publish calls.
    const publishedEvents: Array<{ channel: string; event: object }> = []
    spyOn(eventBusMod.eventBus, "publish").mockImplementation(
      (channel: string, event: object) => {
        publishedEvents.push({ channel, event })
      }
    )

    const { handleDeploy } = await import("./deploy")
    const job = makeJob({
      appId: LOG_TEST_APP_ID_BG,
      commitMessage: "feat: test deploy",
    })

    await handleDeploy(db, job)

    // runBlueGreen must have been called.
    expect(runBlueGreenSpy).toHaveBeenCalledTimes(1)
    const bgOpts = runBlueGreenSpy.mock
      .calls[0]![0] as import("../runner").RunBlueGreenOptions
    expect(bgOpts.appId).toBe(LOG_TEST_APP_ID_BG)
    expect(bgOpts.imageRef).toContain(`app-${LOG_TEST_APP_ID_BG.toLowerCase()}`)

    // Build record must have containerId and status succeeded.
    const buildRows = await listBuildsByApp(db, LOG_TEST_APP_ID_BG)
    const build = buildRows[0]
    expect(build?.status).toBe("succeeded")
    expect(build?.container_id).toBe("cont-123")

    // Build record must have a non-null build_method (fix for build_method null bug).
    expect(build?.build_method).not.toBeNull()

    // commitMessage must be persisted from the job payload.
    expect(build?.commit_message).toBe("feat: test deploy")

    // event deploy.status_change with "Container live" must have been published.
    const liveEvent = publishedEvents.find(
      (e) =>
        (e.event as { type?: string; message?: string }).type ===
          "deploy.status_change" &&
        (e.event as { message?: string }).message === "Container live"
    )
    expect(liveEvent).toBeDefined()
    expect(
      (liveEvent!.event as { data?: { containerId?: string } }).data
        ?.containerId
    ).toBe("cont-123")
  })

  it("marks build failed and does NOT set app status to running when runBlueGreen throws", async () => {
    // Mock runBlueGreen to throw.
    spyOn(runnerMod, "runBlueGreen").mockRejectedValue(
      new Error("healthcheck failed after 6 retries")
    )

    // Capture eventBus.publish calls.
    const publishedEvents: Array<{ channel: string; event: object }> = []
    spyOn(eventBusMod.eventBus, "publish").mockImplementation(
      (channel: string, event: object) => {
        publishedEvents.push({ channel, event })
      }
    )

    const { handleDeploy } = await import("./deploy")
    const job = makeJob({ appId: LOG_TEST_APP_ID_BG })

    await expect(handleDeploy(db, job)).rejects.toThrow(
      "healthcheck failed after 6 retries"
    )

    // Build record must have status failed.
    const buildRows = await listBuildsByApp(db, LOG_TEST_APP_ID_BG)
    const build = buildRows[0]
    expect(build?.status).toBe("failed")
    expect(build?.container_id).toBeNull()

    // App row must NOT have status running (runBlueGreen threw before updating it).
    const appRows = await db
      .select()
      .from(apps)
      .where(eq(apps.id, LOG_TEST_APP_ID_BG))
      .limit(1)
    const appRow = appRows[0]
    expect(appRow?.status).not.toBe("running")

    // build.failed event must have been published.
    const failedEvent = publishedEvents.find(
      (e) => (e.event as { type?: string }).type === "build.failed"
    )
    expect(failedEvent).toBeDefined()

    // deploy.status_change "Container live" must NOT have been published.
    const liveEvent = publishedEvents.find(
      (e) =>
        (e.event as { type?: string; message?: string }).type ===
          "deploy.status_change" &&
        (e.event as { message?: string }).message === "Container live"
    )
    expect(liveEvent).toBeUndefined()
  })
})
