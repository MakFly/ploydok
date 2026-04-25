// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono"
import { z } from "zod"
import { and, eq } from "drizzle-orm"
import { CronExpressionParser } from "cron-parser"
import {
  ScheduledJobCreateSchema,
  ScheduledJobUpdateSchema,
  ListScheduledJobsResponseSchema,
  GetScheduledJobResponseSchema,
} from "@ploydok/shared"
import {
  createScheduledJob,
  getScheduledJob,
  listJobsByOrg,
  updateScheduledJob,
  deleteScheduledJob,
  createScheduledJobRun,
  listRecentJobRuns,
} from "@ploydok/db/queries"
import { createDb, projects, memberships } from "@ploydok/db"
import { env } from "../env"
import type { AuthUser } from "../auth/middleware"
import { childLogger } from "../logger"

const log = childLogger("scheduled-jobs.routes")

type AppEnv = { Variables: { user?: AuthUser } }

function getUser(c: { get: (k: string) => unknown }): AuthUser {
  return c.get("user") as AuthUser
}

async function verifyOrgOwnership(
  db: any,
  orgId: string,
  userId: string
): Promise<boolean> {
  const [membership] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.org_id, orgId), eq(memberships.user_id, userId)))

  return !!membership
}

export function createScheduledJobsRouter() {
  const router = new Hono<AppEnv>()
  const db = createDb(env.DATABASE_URL)

  router.get("/", async (c) => {
    const user = getUser(c)
    if (!user) return c.json({ error: "Unauthorized" }, 401)

    const orgSlug = c.req.param("orgSlug") ?? ""
    const [org] = await db
      .select()
      .from(projects)
      .where(eq(projects.slug, orgSlug))

    if (!org) return c.json({ error: "Organization not found" }, 404)

    const hasAccess = await verifyOrgOwnership(db, org.id, user.id)
    if (!hasAccess) return c.json({ error: "Forbidden" }, 403)

    const jobs = await listJobsByOrg(db, org.id)

    return c.json(
      ListScheduledJobsResponseSchema.parse({
        jobs: jobs.map((job) => ({
          ...job,
          last_run_at: job.last_run_at || null,
          last_run_status: job.last_run_status || null,
          next_run_at: job.next_run_at || null,
        })),
      })
    )
  })

  router.get("/:id", async (c) => {
    const user = getUser(c)
    if (!user) return c.json({ error: "Unauthorized" }, 401)

    const orgSlug = c.req.param("orgSlug") ?? ""
    const jobId = c.req.param("id")

    const [org] = await db
      .select()
      .from(projects)
      .where(eq(projects.slug, orgSlug))

    if (!org) return c.json({ error: "Organization not found" }, 404)

    const hasAccess = await verifyOrgOwnership(db, org.id, user.id)
    if (!hasAccess) return c.json({ error: "Forbidden" }, 403)

    const job = await getScheduledJob(db, jobId)
    if (!job || job.org_id !== org.id) {
      return c.json({ error: "Job not found" }, 404)
    }

    const recentRuns = await listRecentJobRuns(db, jobId, 20)

    return c.json(
      GetScheduledJobResponseSchema.parse({
        job: {
          ...job,
          last_run_at: job.last_run_at || null,
          last_run_status: job.last_run_status || null,
          next_run_at: job.next_run_at || null,
          env: (job.env as Record<string, string>) || {},
        },
        recentRuns: recentRuns.map((run) => ({
          ...run,
          finished_at: run.finished_at || null,
          exit_code: run.exit_code || null,
          output: run.output || null,
          error: run.error || null,
        })),
      })
    )
  })

  router.post("/", async (c) => {
    const user = getUser(c)
    if (!user) return c.json({ error: "Unauthorized" }, 401)

    const orgSlug = c.req.param("orgSlug") ?? ""
    const body = await c.req.json()

    const [org] = await db
      .select()
      .from(projects)
      .where(eq(projects.slug, orgSlug))

    if (!org) return c.json({ error: "Organization not found" }, 404)

    const hasAccess = await verifyOrgOwnership(db, org.id, user.id)
    if (!hasAccess) return c.json({ error: "Forbidden" }, 403)

    try {
      const validated = ScheduledJobCreateSchema.parse(body)

      try {
        const interval = CronExpressionParser.parse(validated.schedule_cron)
        const nextRun = interval.next().toDate()

        const job = await createScheduledJob(db, {
          org_id: org.id,
          name: validated.name,
          schedule_cron: validated.schedule_cron,
          kind: validated.kind,
          app_id: validated.app_id || null,
          image: validated.image || null,
          command: validated.command || null,
          env: validated.env || {},
          timeout_seconds: validated.timeout_seconds,
          enabled: true,
          next_run_at: nextRun,
          last_run_at: null,
          last_run_status: null,
        })

        return c.json(job, 201)
      } catch (cronError) {
        return c.json(
          { error: "Invalid cron expression", details: String(cronError) },
          400
        )
      }
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        return c.json(
          { error: "Validation failed", issues: validationError.issues },
          400
        )
      }
      return c.json({ error: "Invalid request" }, 400)
    }
  })

  router.patch("/:id", async (c) => {
    const user = getUser(c)
    if (!user) return c.json({ error: "Unauthorized" }, 401)

    const orgSlug = c.req.param("orgSlug") ?? ""
    const jobId = c.req.param("id")
    const body = await c.req.json()

    const [org] = await db
      .select()
      .from(projects)
      .where(eq(projects.slug, orgSlug))

    if (!org) return c.json({ error: "Organization not found" }, 404)

    const hasAccess = await verifyOrgOwnership(db, org.id, user.id)
    if (!hasAccess) return c.json({ error: "Forbidden" }, 403)

    const job = await getScheduledJob(db, jobId)
    if (!job || job.org_id !== org.id) {
      return c.json({ error: "Job not found" }, 404)
    }

    try {
      const validated = ScheduledJobUpdateSchema.parse(body)
      let nextRunAt = job.next_run_at

      if (validated.schedule_cron) {
        try {
          const interval = CronExpressionParser.parse(validated.schedule_cron)
          nextRunAt = interval.next().toDate()
        } catch (cronError) {
          return c.json(
            { error: "Invalid cron expression", details: String(cronError) },
            400
          )
        }
      }

      const patch: Record<string, unknown> = {
        env: (validated.env || job.env) as Record<string, string>,
        next_run_at: nextRunAt,
      }
      if (validated.name !== undefined) patch.name = validated.name
      if (validated.schedule_cron !== undefined)
        patch.schedule_cron = validated.schedule_cron
      if (validated.kind !== undefined) patch.kind = validated.kind
      if (validated.app_id !== undefined) patch.app_id = validated.app_id
      if (validated.image !== undefined) patch.image = validated.image
      if (validated.command !== undefined) patch.command = validated.command
      if (validated.timeout_seconds !== undefined)
        patch.timeout_seconds = validated.timeout_seconds
      const updated = await updateScheduledJob(db, jobId, patch as never)

      return c.json(updated)
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        return c.json(
          { error: "Validation failed", issues: validationError.issues },
          400
        )
      }
      return c.json({ error: "Invalid request" }, 400)
    }
  })

  router.delete("/:id", async (c) => {
    const user = getUser(c)
    if (!user) return c.json({ error: "Unauthorized" }, 401)

    const orgSlug = c.req.param("orgSlug") ?? ""
    const jobId = c.req.param("id")

    const [org] = await db
      .select()
      .from(projects)
      .where(eq(projects.slug, orgSlug))

    if (!org) return c.json({ error: "Organization not found" }, 404)

    const hasAccess = await verifyOrgOwnership(db, org.id, user.id)
    if (!hasAccess) return c.json({ error: "Forbidden" }, 403)

    const job = await getScheduledJob(db, jobId)
    if (!job || job.org_id !== org.id) {
      return c.json({ error: "Job not found" }, 404)
    }

    await deleteScheduledJob(db, jobId)
    return c.json({ success: true })
  })

  router.post("/:id/run", async (c) => {
    const user = getUser(c)
    if (!user) return c.json({ error: "Unauthorized" }, 401)

    const orgSlug = c.req.param("orgSlug") ?? ""
    const jobId = c.req.param("id")

    const [org] = await db
      .select()
      .from(projects)
      .where(eq(projects.slug, orgSlug))

    if (!org) return c.json({ error: "Organization not found" }, 404)

    const hasAccess = await verifyOrgOwnership(db, org.id, user.id)
    if (!hasAccess) return c.json({ error: "Forbidden" }, 403)

    const job = await getScheduledJob(db, jobId)
    if (!job || job.org_id !== org.id) {
      return c.json({ error: "Job not found" }, 404)
    }

    const run = await createScheduledJobRun(db, {
      job_id: jobId,
      started_at: new Date(),
      finished_at: null,
      status: "running",
      exit_code: null,
      output: null,
      error: null,
    })

    return c.json(run, 201)
  })

  return router
}
