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
  listRecentJobRuns,
} from "@ploydok/db/queries"
import { apps, memberships, projects, type Db } from "@ploydok/db"
import type { AuthUser } from "../auth/middleware"
import { childLogger } from "../logger"
import { getSharedAgent } from "../debug/singletons"
import {
  runScheduledJobNow,
  ScheduledJobAlreadyRunningError,
} from "../worker/jobs/scheduled-jobs-runner"

const log = childLogger("scheduled-jobs.routes")

type AppEnv = { Variables: { user?: AuthUser } }
type ScheduledJobsRouterOptions = {
  agent?: ReturnType<typeof getSharedAgent>
  runJobNow?: typeof runScheduledJobNow
}

function getUser(c: { get: (k: string) => unknown }): AuthUser {
  return c.get("user") as AuthUser
}

async function verifyOrgOwnership(
  db: Db,
  orgId: string,
  userId: string
): Promise<boolean> {
  const membership = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.org_id, orgId), eq(memberships.user_id, userId)))
    .limit(1)

  return membership.length > 0
}

async function findAppInOrg(
  db: Db,
  orgId: string,
  appId: string
): Promise<{ id: string } | null> {
  const rows = await db
    .select({ id: apps.id })
    .from(apps)
    .where(and(eq(apps.id, appId), eq(apps.project_id, orgId)))
    .limit(1)

  return rows[0] ?? null
}

async function validateJobConfig(
  db: Db,
  orgId: string,
  input: {
    kind: "app_exec" | "container_run"
    app_id?: string | null | undefined
    image?: string | null | undefined
    command?: string[] | null | undefined
  }
): Promise<string | null> {
  if (!input.command || input.command.length === 0) {
    return "command is required"
  }
  if (input.kind === "app_exec" && !input.app_id) {
    return "app_id is required for app_exec"
  }
  if (input.kind === "container_run" && !input.image && !input.app_id) {
    return "image or app_id is required for container_run"
  }
  if (input.app_id) {
    const app = await findAppInOrg(db, orgId, input.app_id)
    if (!app) return "app_id must belong to the organization"
  }
  return null
}

export function createScheduledJobsRouter(
  db: Db,
  opts: ScheduledJobsRouterOptions = {}
) {
  const router = new Hono<AppEnv>()
  const agent = opts.agent ?? getSharedAgent()
  const runJobNow = opts.runJobNow ?? runScheduledJobNow

  router.get("/", async (c) => {
    const user = getUser(c)
    if (!user) return c.json({ error: "Unauthorized" }, 401)

    const orgSlug = c.req.param("orgSlug") ?? ""
    const org = await db
      .select()
      .from(projects)
      .where(eq(projects.slug, orgSlug))
      .limit(1)

    if (org.length === 0) {
      return c.json({ error: "Organization not found" }, 404)
    }

    const orgRow = org[0]!
    const hasAccess = await verifyOrgOwnership(db, orgRow.id, user.id)
    if (!hasAccess) return c.json({ error: "Forbidden" }, 403)

    const jobs = await listJobsByOrg(db, orgRow.id)

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

    const org = await db
      .select()
      .from(projects)
      .where(eq(projects.slug, orgSlug))
      .limit(1)

    if (org.length === 0) {
      return c.json({ error: "Organization not found" }, 404)
    }

    const orgRow = org[0]!
    const hasAccess = await verifyOrgOwnership(db, orgRow.id, user.id)
    if (!hasAccess) return c.json({ error: "Forbidden" }, 403)

    const job = await getScheduledJob(db, jobId)
    if (!job || job.org_id !== orgRow.id) {
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

    const org = await db
      .select()
      .from(projects)
      .where(eq(projects.slug, orgSlug))
      .limit(1)

    if (org.length === 0) {
      return c.json({ error: "Organization not found" }, 404)
    }

    const orgRow = org[0]!
    const hasAccess = await verifyOrgOwnership(db, orgRow.id, user.id)
    if (!hasAccess) return c.json({ error: "Forbidden" }, 403)

    try {
      const validated = ScheduledJobCreateSchema.parse(body)
      const configError = await validateJobConfig(db, orgRow.id, validated)
      if (configError) {
        return c.json({ error: "Validation failed", details: configError }, 400)
      }

      try {
        const interval = CronExpressionParser.parse(validated.schedule_cron)
        const nextRun = interval.next().toDate()

        const job = await createScheduledJob(db, {
          org_id: orgRow.id,
          name: validated.name,
          schedule_cron: validated.schedule_cron,
          kind: validated.kind,
          app_id: validated.app_id || null,
          image: validated.image || null,
          command: validated.command || null,
          env: validated.env || {},
          timeout_seconds: validated.timeout_seconds,
          enabled: validated.enabled,
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

    const org = await db
      .select()
      .from(projects)
      .where(eq(projects.slug, orgSlug))
      .limit(1)

    if (org.length === 0) {
      return c.json({ error: "Organization not found" }, 404)
    }

    const orgRow = org[0]!
    const hasAccess = await verifyOrgOwnership(db, orgRow.id, user.id)
    if (!hasAccess) return c.json({ error: "Forbidden" }, 403)

    const job = await getScheduledJob(db, jobId)
    if (!job || job.org_id !== orgRow.id) {
      return c.json({ error: "Job not found" }, 404)
    }

    try {
      const validated = ScheduledJobUpdateSchema.parse(body)
      const configError = await validateJobConfig(db, orgRow.id, {
        kind: validated.kind ?? job.kind,
        app_id: validated.app_id ?? job.app_id,
        image: validated.image ?? job.image,
        command: validated.command ?? job.command,
      })
      if (configError) {
        return c.json({ error: "Validation failed", details: configError }, 400)
      }

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
      if (validated.schedule_cron !== undefined) {
        patch.schedule_cron = validated.schedule_cron
      }
      if (validated.kind !== undefined) patch.kind = validated.kind
      if (validated.app_id !== undefined) patch.app_id = validated.app_id
      if (validated.image !== undefined) patch.image = validated.image
      if (validated.command !== undefined) patch.command = validated.command
      if (validated.timeout_seconds !== undefined) {
        patch.timeout_seconds = validated.timeout_seconds
      }
      if (validated.enabled !== undefined) patch.enabled = validated.enabled

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

    const org = await db
      .select()
      .from(projects)
      .where(eq(projects.slug, orgSlug))
      .limit(1)

    if (org.length === 0) {
      return c.json({ error: "Organization not found" }, 404)
    }

    const orgRow = org[0]!
    const hasAccess = await verifyOrgOwnership(db, orgRow.id, user.id)
    if (!hasAccess) return c.json({ error: "Forbidden" }, 403)

    const job = await getScheduledJob(db, jobId)
    if (!job || job.org_id !== orgRow.id) {
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

    const org = await db
      .select()
      .from(projects)
      .where(eq(projects.slug, orgSlug))
      .limit(1)

    if (org.length === 0) {
      return c.json({ error: "Organization not found" }, 404)
    }

    const orgRow = org[0]!
    const hasAccess = await verifyOrgOwnership(db, orgRow.id, user.id)
    if (!hasAccess) return c.json({ error: "Forbidden" }, 403)

    const job = await getScheduledJob(db, jobId)
    if (!job || job.org_id !== orgRow.id) {
      return c.json({ error: "Job not found" }, 404)
    }

    try {
      const run = await runJobNow(db, agent, jobId, {
        allowDisabled: true,
        source: "manual",
      })
      return c.json(run, 200)
    } catch (err) {
      if (err instanceof ScheduledJobAlreadyRunningError) {
        return c.json({ error: "Job is already running" }, 409)
      }
      log.error(
        { err, jobId, userId: user.id },
        "manual scheduled job run failed"
      )
      return c.json(
        {
          error: "Manual run failed",
          details: err instanceof Error ? err.message : String(err),
        },
        500
      )
    }
  })

  return router
}
