// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Integration test — worker loop (zero mocks).
 *
 * Strategy for PLOYDOK_BUILD_DIR: leave the default (~/.ploydok-dev/builds).
 * cleanupBuild uses `rm({ recursive: true, force: true })`, so it never
 * errors even when the directory does not exist.
 *
 * env.ts reads via `Bun.env`, not `process.env`, so setting the env var at
 * module scope would not take effect anyway. The default is safe.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { eq, sql } from "drizzle-orm"
import * as schema from "@ploydok/db"
import { enqueueJob } from "@ploydok/db/queries"
import { startWorker } from "./index"

const { jobs, job_runs } = schema

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create an in-memory SQLite DB with all tables needed by the worker.
 *
 * We apply migrations in-order (DDL only, no data) so foreign keys are
 * respected. We disable FK enforcement while creating tables so the order
 * of CREATE TABLE statements inside each block does not matter, then
 * re-enable for the tests.
 */
function makeTestDb() {
  const sqlite = new Database(":memory:")
  sqlite.exec("PRAGMA journal_mode = WAL;")
  // We temporarily disable FK checks during schema bootstrap — re-enabled after.
  sqlite.exec("PRAGMA foreign_keys = OFF;")

  // migration 0000
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY NOT NULL,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      recovery_token_hash TEXT,
      recovery_expires_at INTEGER
    );

    CREATE TABLE projects (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE apps (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      status TEXT DEFAULT 'created' NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      git_provider TEXT,
      repo_full_name TEXT,
      branch TEXT,
      root_dir TEXT,
      dockerfile_path TEXT,
      install_command TEXT,
      build_command TEXT,
      start_command TEXT,
      watch_paths TEXT,
      container_id TEXT,
      restart_policy TEXT NOT NULL DEFAULT 'unless-stopped',
      domain TEXT,
      build_method TEXT DEFAULT 'auto',
      healthcheck_path TEXT DEFAULT '/',
      healthcheck_port INTEGER,
      healthcheck_interval_s INTEGER DEFAULT 5,
      healthcheck_timeout_s INTEGER DEFAULT 3,
      healthcheck_retries INTEGER DEFAULT 6,
      healthcheck_start_period_s INTEGER DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      user_id TEXT,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      metadata TEXT DEFAULT '{}' NOT NULL,
      created_at INTEGER NOT NULL,
      prev_hash TEXT,
      hash TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE backup_codes (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      consumed_at INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE passkeys (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      credential_id TEXT NOT NULL UNIQUE,
      public_key BLOB NOT NULL,
      counter INTEGER DEFAULT 0 NOT NULL,
      transports TEXT DEFAULT '[]' NOT NULL,
      device_name TEXT,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE secrets (
      id TEXT PRIMARY KEY NOT NULL,
      app_id TEXT,
      project_id TEXT,
      scope TEXT NOT NULL,
      key TEXT NOT NULL,
      value_ciphertext BLOB NOT NULL,
      nonce BLOB NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE sessions (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      refresh_token_hash TEXT NOT NULL,
      user_agent TEXT NOT NULL,
      ip TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      revoked_at INTEGER,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `)

  // migration 0001 — jobs, job_runs, builds
  sqlite.exec(`
    CREATE TABLE builds (
      id TEXT PRIMARY KEY NOT NULL,
      app_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending' NOT NULL,
      build_method TEXT,
      image_tag TEXT,
      container_id TEXT,
      commit_sha TEXT,
      log_path TEXT,
      error_message TEXT,
      started_at INTEGER,
      finished_at INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
    );
    CREATE INDEX builds_app_id_idx ON builds (app_id);
    CREATE INDEX builds_status_idx ON builds (status);

    CREATE TABLE jobs (
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT DEFAULT 'pending' NOT NULL,
      run_at INTEGER,
      attempts INTEGER DEFAULT 0 NOT NULL,
      max_attempts INTEGER DEFAULT 3 NOT NULL,
      error_message TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX jobs_status_run_at_idx ON jobs (status, run_at);

    CREATE TABLE job_runs (
      id TEXT PRIMARY KEY NOT NULL,
      job_id TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      error TEXT,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );
  `)

  // migration 0002 — github_app
  sqlite.exec(`
    CREATE TABLE github_app (
      id TEXT PRIMARY KEY NOT NULL,
      app_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      client_secret_enc BLOB NOT NULL,
      client_secret_nonce BLOB NOT NULL,
      pem_enc BLOB NOT NULL,
      pem_nonce BLOB NOT NULL,
      webhook_secret_enc BLOB NOT NULL,
      webhook_secret_nonce BLOB NOT NULL,
      created_at INTEGER NOT NULL
    );
  `)

  sqlite.exec("PRAGMA foreign_keys = ON;")

  return drizzle(sqlite, { schema })
}

// ---------------------------------------------------------------------------
// Polling helper
// ---------------------------------------------------------------------------

async function pollUntil<T>(
  fn: () => Promise<T | undefined>,
  predicate: (v: T | undefined) => boolean,
  timeoutMs: number,
  intervalMs = 50,
): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const v = await fn()
    if (predicate(v)) return v
    await new Promise<void>((r) => setTimeout(r, intervalMs))
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("worker loop — integration (zero mocks)", () => {
  let db: ReturnType<typeof makeTestDb>
  let handle: ReturnType<typeof startWorker>

  beforeEach(() => {
    db = makeTestDb()
  })

  afterEach(() => {
    handle?.stop()
  })

  it("picks a pending cleanup.build job and marks it done", async () => {
    handle = startWorker(db, { intervalMs: 50 })

    const job = await enqueueJob(db, {
      type: "cleanup.build",
      payload: { appId: "app-x", buildId: "build-y" },
    })

    const final = await pollUntil(
      async () => {
        const rows = await db
          .select()
          .from(jobs)
          .where(eq(jobs.id, job.id))
          .limit(1)
        return rows[0]
      },
      (row) => row?.status === "done" || row?.status === "failed",
      3_000,
    )

    expect(final?.status).toBe("done")
    expect(final?.attempts).toBe(1)

    const runs = await db
      .select()
      .from(job_runs)
      .where(eq(job_runs.job_id, job.id))
    expect(runs).toHaveLength(1)
    expect(runs[0]?.error).toBeNull()
  })

  it("marks an unknown job type as failed without retry", async () => {
    handle = startWorker(db, { intervalMs: 50 })

    // Bypass TypeScript enum constraint via raw SQL insert
    const unknownId = `unknown-${Date.now()}`
    const nowMs = Date.now()
    db.run(
      sql`INSERT INTO jobs (id, type, payload, status, attempts, max_attempts, created_at, updated_at)
          VALUES (${unknownId}, 'does.not.exist', '{}', 'pending', 0, 3, ${nowMs}, ${nowMs})`,
    )

    const final = await pollUntil(
      async () => {
        const rows = await db
          .select()
          .from(jobs)
          .where(eq(jobs.id, unknownId))
          .limit(1)
        return rows[0]
      },
      (row) => row?.status === "failed",
      3_000,
    )

    expect(final?.status).toBe("failed")
    expect(final?.error_message).toContain("unknown job type")

    const runs = await db
      .select()
      .from(job_runs)
      .where(eq(job_runs.job_id, unknownId))
    expect(runs).toHaveLength(1)
    expect(runs[0]?.error).toContain("unknown job type")
  })

  it("stops cleanly — no new jobs processed after handle.stop()", async () => {
    handle = startWorker(db, { intervalMs: 50 })

    // Enqueue a first job and let it finish so the worker is idle
    const job1 = await enqueueJob(db, {
      type: "cleanup.build",
      payload: { appId: "app-stop-1", buildId: "b1" },
    })
    await pollUntil(
      async () => {
        const rows = await db
          .select()
          .from(jobs)
          .where(eq(jobs.id, job1.id))
          .limit(1)
        return rows[0]
      },
      (row) => row?.status === "done" || row?.status === "failed",
      3_000,
    )

    // Stop the worker
    handle.stop()

    // Enqueue a second job — it must stay pending
    const job2 = await enqueueJob(db, {
      type: "cleanup.build",
      payload: { appId: "app-stop-2", buildId: "b2" },
    })

    // Wait 300ms — enough for 6 intervals to fire if the worker were still running
    await new Promise<void>((r) => setTimeout(r, 300))

    const rows = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, job2.id))
      .limit(1)
    expect(rows[0]?.status).toBe("pending")
  })
})
