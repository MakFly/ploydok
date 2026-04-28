// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, mock } from "bun:test"
import { Hono } from "hono"

const getScheduledJobMock = mock(async () => ({
  id: "job-1",
  org_id: "org-1",
  name: "Job",
}))
const createScheduledJobMock = mock(async () => ({ id: "job-created" }))
const listJobsByOrgMock = mock(async () => [])
const updateScheduledJobMock = mock(async () => ({ id: "job-1" }))
const deleteScheduledJobMock = mock(async () => undefined)
const listRecentJobRunsMock = mock(async () => [])
const createScheduledJobRunMock = mock(async () => ({ id: "run-created" }))
const updateScheduledJobRunMock = mock(async () => ({ id: "run-updated" }))
const listDueJobsMock = mock(async () => [])
const listAppVolumesMock = mock(async () => [])

mock.module("@ploydok/db/queries", () => ({
  createScheduledJob: createScheduledJobMock,
  getScheduledJob: getScheduledJobMock,
  listJobsByOrg: listJobsByOrgMock,
  updateScheduledJob: updateScheduledJobMock,
  deleteScheduledJob: deleteScheduledJobMock,
  listRecentJobRuns: listRecentJobRunsMock,
  createScheduledJobRun: createScheduledJobRunMock,
  updateScheduledJobRun: updateScheduledJobRunMock,
  listDueJobs: listDueJobsMock,
  listAppVolumes: listAppVolumesMock,
  getAppForUser: mock(async () => null),
  getMembership: mock(async () => null),
  listEventWebhooks: mock(async () => []),
  getEventWebhook: mock(async () => null),
  createEventWebhook: mock(async () => null),
  updateEventWebhook: mock(async () => null),
  deleteEventWebhook: mock(async () => false),
  listEnabledWebhooksForEvent: mock(async () => []),
}))

const { createScheduledJobsRouter } = await import("./scheduled-jobs")
const { ScheduledJobAlreadyRunningError } =
  await import("../worker/jobs/scheduled-jobs-runner")

const fakeUser = {
  id: "user-1",
  email: "test@example.com",
  display_name: "Test User",
  session_id: "sess-1",
}

function makeDb(
  options: { membershipRows?: Array<Record<string, unknown>> } = {}
) {
  let selectCount = 0
  const membershipRows = options.membershipRows ?? [
    { org_id: "org-1", user_id: fakeUser.id, role: "owner" },
  ]
  return {
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(async () => {
            selectCount += 1
            return selectCount % 2 === 1
              ? [{ id: "org-1", slug: "acme" }]
              : membershipRows
          }),
        })),
      })),
    })),
  }
}

type RunJobNow = NonNullable<
  Parameters<typeof createScheduledJobsRouter>[1]
>["runJobNow"]

function makeRunRow() {
  return {
    id: "run-1",
    job_id: "job-1",
    started_at: new Date("2026-04-28T10:00:00.000Z"),
    finished_at: new Date("2026-04-28T10:00:05.000Z"),
    status: "succeeded" as const,
    exit_code: 0,
    output: "ok\n",
    error: null,
  }
}

function makeApp(
  runJobNow: RunJobNow = mock(async () => makeRunRow()),
  db = makeDb()
) {
  const app = new Hono()
  app.use("*", async (c, next) => {
    ;(c as { set: (key: string, value: unknown) => void }).set("user", fakeUser)
    await next()
  })
  app.route(
    "/orgs/:orgSlug/scheduled-jobs",
    createScheduledJobsRouter(db as never, {
      agent: { containerExec: mock() } as never,
      runJobNow,
    })
  )
  return { app, runJobNow }
}

beforeEach(() => {
  getScheduledJobMock.mockClear()
  createScheduledJobMock.mockClear()
  listJobsByOrgMock.mockClear()
  updateScheduledJobMock.mockClear()
  deleteScheduledJobMock.mockClear()
  listRecentJobRunsMock.mockClear()
  createScheduledJobRunMock.mockClear()
  updateScheduledJobRunMock.mockClear()
  listDueJobsMock.mockClear()
  listAppVolumesMock.mockClear()
})

describe("POST /orgs/:orgSlug/scheduled-jobs/:id/run", () => {
  it("runs the job immediately and returns the completed run", async () => {
    const { app, runJobNow } = makeApp()

    const res = await app.request("/orgs/acme/scheduled-jobs/job-1/run", {
      method: "POST",
    })

    expect(res.status).toBe(200)
    expect(getScheduledJobMock).toHaveBeenCalledWith(expect.anything(), "job-1")
    expect(runJobNow).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "job-1",
      { allowDisabled: true, source: "manual" }
    )
    expect(await res.json()).toMatchObject({
      id: "run-1",
      job_id: "job-1",
      status: "succeeded",
      exit_code: 0,
      output: "ok\n",
    })
  })

  it("returns 409 when the job is already running", async () => {
    const runJobNow = mock(async () => {
      throw new ScheduledJobAlreadyRunningError("job-1")
    })
    const { app } = makeApp(runJobNow)

    const res = await app.request("/orgs/acme/scheduled-jobs/job-1/run", {
      method: "POST",
    })

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: "Job is already running" })
  })
})

describe("POST /orgs/:orgSlug/scheduled-jobs", () => {
  it("rejects users that are not accepted organization owners", async () => {
    const { app } = makeApp(
      mock(async () => makeRunRow()),
      makeDb({ membershipRows: [] })
    )

    const res = await app.request("/orgs/acme/scheduled-jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Unsafe job",
        schedule_cron: "*/5 * * * *",
        kind: "container_run",
        image: "alpine:3.20",
        command: ["sh", "-c", "id"],
        enabled: true,
      }),
    })

    expect(res.status).toBe(403)
    expect(createScheduledJobMock).not.toHaveBeenCalled()
  })
})
