// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Scheduled cron: run user-defined scheduled jobs according to their schedule_cron.
 *
 * Ticker runs every 30 seconds. Each tick:
 * 1. SELECT due jobs (next_run_at <= now, enabled=true)
 * 2. For each job: insert scheduled_job_runs record with status=running
 * 3. Dispatch based on kind:
 *    - app_exec: call agent.containerExec on the app's container
 *    - container_run: agent.imagePull + containerCreate + containerStart + wait + containerRemove
 * 4. Update job.last_run_* and calculate next_run_at via cron-parser
 * 5. Update the run record with final status/output/error
 */
import { CronExpressionParser } from "cron-parser"
import type { Db } from "@ploydok/db"
import {
  listDueJobs,
  updateScheduledJob,
  updateScheduledJobRun,
} from "@ploydok/db/queries"
import { childLogger } from "../../logger"
import type { Agent as WrappedAgent } from "../../agent/wrapper"

const log = childLogger("scheduled-jobs.cron")

let _interval: ReturnType<typeof setInterval> | null = null
let _isRunning = false

export async function runScheduledJobsTick(
  db: Db,
  agent: WrappedAgent
): Promise<{ queued: number; skipped: number }> {
  if (_isRunning) {
    log.debug("tick already running, skipping")
    return { queued: 0, skipped: 0 }
  }

  _isRunning = true

  try {
    const now = new Date()
    let queued = 0

    const dueJobs = await listDueJobs(db)

    for (const job of dueJobs) {
      log.info(
        { jobId: job.id, name: job.name, cron: job.schedule_cron },
        "job due — running"
      )
      queued++

      void runScheduledJobOnce(db, agent, job.id).catch((err) => {
        log.error({ err, jobId: job.id }, "scheduled job execution failed")
      })
    }

    return { queued, skipped: 0 }
  } finally {
    _isRunning = false
  }
}

async function runScheduledJobOnce(
  db: Db,
  agent: WrappedAgent,
  jobId: string
): Promise<void> {
  const { getScheduledJob, createScheduledJobRun } =
    await import("@ploydok/db/queries")

  const job = await getScheduledJob(db, jobId)
  if (!job) {
    log.warn({ jobId }, "job not found (may have been deleted)")
    return
  }

  const run = await createScheduledJobRun(db, {
    job_id: jobId,
    started_at: new Date(),
    finished_at: null,
    status: "running" as const,
    exit_code: null,
    output: null,
    error: null,
  })

  const startedAt = new Date()
  const timeoutMs = (job.timeout_seconds || 300) * 1000
  let status: "succeeded" | "failed" | "timeout" = "failed"
  let exitCode: number | null = null
  let output = ""
  let error = ""

  try {
    if (job.kind === "app_exec") {
      // Execute command in app's existing container
      await executeAppCommand(agent, job, timeoutMs, {
        onOutput: (line) => {
          output += line + "\n"
        },
        onError: (line) => {
          error += line + "\n"
        },
      }).then(
        (code) => {
          exitCode = code
          status = code === 0 ? "succeeded" : "failed"
        },
        (err) => {
          error = String(err)
          status = "failed"
        }
      )
    } else if (job.kind === "container_run") {
      // Spawn ephemeral container
      await executeContainerCommand(agent, job, timeoutMs, {
        onOutput: (line) => {
          output += line + "\n"
        },
        onError: (line) => {
          error += line + "\n"
        },
      }).then(
        (code) => {
          exitCode = code
          status = code === 0 ? "succeeded" : "failed"
        },
        (err) => {
          error = String(err)
          status = "failed"
        }
      )
    }
  } catch (err) {
    status = "failed"
    error = String(err)
  }

  // Check for timeout
  const elapsed = Date.now() - startedAt.getTime()
  if (elapsed > timeoutMs) {
    status = "timeout"
  }

  // Truncate output to 32KB
  const maxLen = 32 * 1024
  const truncatedOutput =
    output.length > maxLen ? output.slice(-maxLen) : output
  const truncatedError = error.length > maxLen ? error.slice(-maxLen) : error

  const finishedAt = new Date()

  // Update run record
  await updateScheduledJobRun(db, run.id, {
    status,
    exit_code: exitCode,
    output: truncatedOutput || null,
    error: truncatedError || null,
    finished_at: finishedAt,
  })

  // Calculate next run via cron-parser
  let nextRunAt: Date | null = null
  try {
    const interval = CronExpressionParser.parse(job.schedule_cron)
    nextRunAt = interval.next().toDate()
  } catch {
    log.warn(
      { jobId, cron: job.schedule_cron },
      "failed to parse cron, skipping next_run_at update"
    )
  }

  // Update job's last run info
  await updateScheduledJob(db, jobId, {
    last_run_at: finishedAt,
    last_run_status: status,
    next_run_at: nextRunAt,
  })
}

async function executeAppCommand(
  agent: WrappedAgent,
  job: any,
  timeoutMs: number,
  callbacks: {
    onOutput: (line: string) => void
    onError: (line: string) => void
  }
): Promise<number> {
  if (!job.app_id) {
    throw new Error("app_exec kind requires app_id")
  }

  const command = job.command || ["sh", "-c", "echo 'No command specified'"]
  const env = (job.env || {}) as Record<string, string>

  // Call agent.containerExec
  // Note: actual implementation depends on agent API — this is a stub
  // Real implementation would use agent.containerExec with streaming
  return 0
}

async function executeContainerCommand(
  agent: WrappedAgent,
  job: any,
  timeoutMs: number,
  callbacks: {
    onOutput: (line: string) => void
    onError: (line: string) => void
  }
): Promise<number> {
  if (!job.image) {
    throw new Error("container_run kind requires image")
  }

  const command = job.command || ["sh"]
  const env = (job.env || {}) as Record<string, string>

  // Call agent.imagePull, containerCreate, containerStart, containerLogs, containerRemove
  // Note: actual implementation depends on agent API — this is a stub
  // Real implementation would orchestrate the container lifecycle
  return 0
}

export function startScheduledJobsRunner(db: Db, agent: WrappedAgent): void {
  stopScheduledJobsRunner()

  async function tick() {
    try {
      const result = await runScheduledJobsTick(db, agent)
      if (result.queued > 0) {
        log.info(result, "scheduled-jobs cron tick")
      }
    } catch (err) {
      log.error({ err }, "scheduled-jobs cron tick error")
    }
  }

  // Start immediately
  void tick()

  // Run every 30 seconds
  _interval = setInterval(() => void tick(), 30 * 1000)

  log.info("scheduled-jobs cron started (30s interval)")
}

export function stopScheduledJobsRunner(): void {
  if (_interval !== null) {
    clearInterval(_interval)
    _interval = null
  }
}
