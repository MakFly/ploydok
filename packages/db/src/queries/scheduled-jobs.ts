// SPDX-License-Identifier: AGPL-3.0-only
import { and, desc, eq, lte } from "drizzle-orm"
import type { Db } from "../client"
import { scheduled_jobs, scheduled_job_runs } from "../schema"
import type {
  ScheduledJobRow,
  ScheduledJobInsert,
  ScheduledJobRunRow,
  ScheduledJobRunInsert,
} from "../schema"
import { nanoid } from "nanoid"

export async function createScheduledJob(
  db: Db,
  data: Omit<ScheduledJobInsert, "id" | "created_at" | "updated_at">
): Promise<ScheduledJobRow> {
  const [row] = await db
    .insert(scheduled_jobs)
    .values({
      ...data,
      id: nanoid(),
    })
    .returning()

  return row!
}

export async function getScheduledJob(
  db: Db,
  jobId: string
): Promise<ScheduledJobRow | null> {
  const [row] = await db
    .select()
    .from(scheduled_jobs)
    .where(eq(scheduled_jobs.id, jobId))

  return row ?? null
}

export async function listJobsByOrg(
  db: Db,
  orgId: string
): Promise<ScheduledJobRow[]> {
  return db
    .select()
    .from(scheduled_jobs)
    .where(eq(scheduled_jobs.org_id, orgId))
    .orderBy(scheduled_jobs.created_at)
}

export async function updateScheduledJob(
  db: Db,
  jobId: string,
  data: Partial<Omit<ScheduledJobRow, "id" | "created_at">>
): Promise<ScheduledJobRow | null> {
  const [row] = await db
    .update(scheduled_jobs)
    .set({
      ...data,
      updated_at: new Date(),
    })
    .where(eq(scheduled_jobs.id, jobId))
    .returning()

  return row ?? null
}

export async function deleteScheduledJob(db: Db, jobId: string): Promise<void> {
  await db.delete(scheduled_jobs).where(eq(scheduled_jobs.id, jobId))
}

export async function listDueJobs(db: Db): Promise<ScheduledJobRow[]> {
  return db
    .select()
    .from(scheduled_jobs)
    .where(
      and(
        eq(scheduled_jobs.enabled, true),
        lte(scheduled_jobs.next_run_at, new Date())
      )
    )
    .orderBy(scheduled_jobs.next_run_at)
}

export async function createScheduledJobRun(
  db: Db,
  data: Omit<ScheduledJobRunInsert, "id">
): Promise<ScheduledJobRunRow> {
  const [row] = await db
    .insert(scheduled_job_runs)
    .values({
      ...data,
      id: nanoid(),
    })
    .returning()

  return row!
}

export async function getScheduledJobRun(
  db: Db,
  runId: string
): Promise<ScheduledJobRunRow | null> {
  const [row] = await db
    .select()
    .from(scheduled_job_runs)
    .where(eq(scheduled_job_runs.id, runId))

  return row ?? null
}

export async function listRecentJobRuns(
  db: Db,
  jobId: string,
  limit: number = 20
): Promise<ScheduledJobRunRow[]> {
  return db
    .select()
    .from(scheduled_job_runs)
    .where(eq(scheduled_job_runs.job_id, jobId))
    .orderBy(desc(scheduled_job_runs.started_at))
    .limit(limit)
}

export async function updateScheduledJobRun(
  db: Db,
  runId: string,
  data: Partial<Omit<ScheduledJobRunRow, "id">>
): Promise<ScheduledJobRunRow | null> {
  const [row] = await db
    .update(scheduled_job_runs)
    .set(data)
    .where(eq(scheduled_job_runs.id, runId))
    .returning()

  return row ?? null
}
