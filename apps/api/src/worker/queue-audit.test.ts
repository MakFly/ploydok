// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, spyOn } from "bun:test"
import { queueAudit, auditEnqueued, auditClaimed, auditUnauthorized, auditDuplicateClaim } from "./queue-audit"

describe("queue audit helpers", () => {
  it("logs enqueued events with required payload", () => {
    const infoSpy = spyOn(queueAudit, "info")

    auditEnqueued({
      jobName: "deploy.requested",
      jobId: "job-1",
      rowId: "row-1",
      actor: "user-1",
      source: "github",
    })

    expect(infoSpy).toHaveBeenCalled()
    const [meta, msg] = infoSpy.mock.calls.at(-1)! as [
      { event: string; jobName: string; jobId: string; rowId: string; actor: string | null; source: string },
      string
    ]
    expect(meta).toMatchObject({
      event: "enqueued",
      jobName: "deploy.requested",
      jobId: "job-1",
      rowId: "row-1",
      actor: "user-1",
      source: "github",
    })
    expect(msg).toBe("Job enqueued: deploy.requested (job-1)")
  })

  it("logs claimed events with required payload", () => {
    const infoSpy = spyOn(queueAudit, "info")

    auditClaimed({
      jobName: "build.finished",
      jobId: "job-2",
      rowId: "row-2",
      actor: null,
      source: "system",
    })

    expect(infoSpy).toHaveBeenCalled()
    const [meta, msg] = infoSpy.mock.calls.at(-1)! as [
      { event: string; jobName: string; jobId: string; rowId: string; actor: string | null; source: string },
      string
    ]
    expect(meta).toMatchObject({
      event: "claimed",
      jobName: "build.finished",
      jobId: "job-2",
      rowId: "row-2",
      actor: null,
      source: "system",
    })
    expect(msg).toBe("Job claimed: build.finished (job-2)")
  })

  it("logs unauthorized events with refusal reason payload", () => {
    const warnSpy = spyOn(queueAudit, "warn")

    auditUnauthorized({
      jobName: "deploy.requested",
      jobId: "job-3",
      payload: { buildId: "build-3" },
      reason: "no matching pending build row",
    })

    expect(warnSpy).toHaveBeenCalled()
    const [meta, msg] = warnSpy.mock.calls.at(-1)! as [
      { event: string; jobName: string; jobId: string; reason: string; payload: unknown },
      string
    ]
    expect(meta).toMatchObject({
      event: "unauthorized",
      jobName: "deploy.requested",
      jobId: "job-3",
      reason: "no matching pending build row",
      payload: { buildId: "build-3" },
    })
    expect(msg).toBe("Unauthorized job execution: deploy.requested (job-3)")
  })

  it("logs duplicate claim events with required payload", () => {
    const warnSpy = spyOn(queueAudit, "warn")

    auditDuplicateClaim({
      jobName: "deploy.requested",
      jobId: "job-4",
      rowId: "row-4",
    })

    expect(warnSpy).toHaveBeenCalled()
    const [meta, msg] = warnSpy.mock.calls.at(-1)! as [
      { event: string; jobName: string; jobId: string; rowId: string },
      string
    ]
    expect(meta).toMatchObject({
      event: "duplicate_claim",
      jobName: "deploy.requested",
      jobId: "job-4",
      rowId: "row-4",
    })
    expect(msg).toBe("Duplicate claim attempt: deploy.requested (job-4)")
  })
})
