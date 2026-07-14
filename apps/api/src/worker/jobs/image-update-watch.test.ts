// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, mock, test } from "bun:test"
import type { Db } from "@ploydok/db"
import type { Agent } from "../../agent"
import {
  runImageUpdateWatchOnce,
  type RedeployTrigger,
} from "./image-update-watch"

interface CandidateRow {
  id: string
  name: string
  project_id: string
  owner_id: string
  status: string
  image_ref: string | null
  registry_credential_id: string | null
  last_image_digest: string | null
  pending_image_digest: string | null
}

function app(overrides: Partial<CandidateRow> = {}): CandidateRow {
  return {
    id: overrides.id ?? "app-1",
    name: overrides.name ?? "Image App",
    project_id: overrides.project_id ?? "proj-1",
    owner_id: overrides.owner_id ?? "user-1",
    status: overrides.status ?? "running",
    image_ref:
      "image_ref" in overrides
        ? overrides.image_ref!
        : "ghcr.io/org/app:latest",
    registry_credential_id:
      "registry_credential_id" in overrides
        ? overrides.registry_credential_id!
        : null,
    last_image_digest:
      "last_image_digest" in overrides ? overrides.last_image_digest! : null,
    pending_image_digest:
      "pending_image_digest" in overrides
        ? overrides.pending_image_digest!
        : null,
  }
}

interface FakeDbHandle {
  db: Db
  updateCalls: Array<Record<string, unknown>>
}

function fakeDb(candidates: CandidateRow[]): FakeDbHandle {
  const updateCalls: Array<Record<string, unknown>> = []

  const db = {
    select() {
      const chain = {
        from() {
          return chain
        },
        innerJoin() {
          return chain
        },
        where() {
          return Promise.resolve(candidates)
        },
      }
      return chain
    },
    update() {
      return {
        set(values: Record<string, unknown>) {
          updateCalls.push(values)
          return {
            where() {
              return Promise.resolve()
            },
          }
        },
      }
    },
    insert() {
      return {
        values() {
          return Promise.resolve()
        },
      }
    },
  } as unknown as Db

  return { db, updateCalls }
}

function agentWithDigest(digest: string): {
  agent: Agent
  registryImageDigest: ReturnType<typeof mock>
} {
  const registryImageDigest = mock(async () => ({ digest }))
  return {
    agent: { registryImageDigest } as unknown as Agent,
    registryImageDigest,
  }
}

describe("runImageUpdateWatchOnce", () => {
  test("unchanged digest → no deploy, no notification", async () => {
    const candidate = app({ last_image_digest: "sha256:aaa" })
    const { db, updateCalls } = fakeDb([candidate])
    const { agent } = agentWithDigest("sha256:aaa")
    const enqueueDeploy = mock<RedeployTrigger>(async () => ({
      jobId: "job-1",
    }))

    const result = await runImageUpdateWatchOnce(db, agent, {
      enqueueDeploy,
    })

    expect(result).toMatchObject({
      scanned: 1,
      baseline: 0,
      updated: 0,
      unchanged: 1,
      skipped: 0,
    })
    expect(updateCalls.length).toBe(0)
    expect(enqueueDeploy).not.toHaveBeenCalled()
  })

  test("first observation (null last_image_digest) → baseline set, no deploy", async () => {
    const candidate = app({ last_image_digest: null })
    const { db, updateCalls } = fakeDb([candidate])
    const { agent } = agentWithDigest("sha256:bbb")
    const enqueueDeploy = mock<RedeployTrigger>(async () => ({
      jobId: "job-1",
    }))

    const result = await runImageUpdateWatchOnce(db, agent, {
      enqueueDeploy,
    })

    expect(result).toMatchObject({
      scanned: 1,
      baseline: 1,
      updated: 0,
      unchanged: 0,
      skipped: 0,
    })
    expect(updateCalls.length).toBe(1)
    expect(updateCalls[0]?.last_image_digest).toBe("sha256:bbb")
    expect(enqueueDeploy).not.toHaveBeenCalled()
  })

  test("changed digest → deploy is reserved without advancing deployed digest", async () => {
    const candidate = app({ id: "app-2", last_image_digest: "sha256:aaa" })
    const { db, updateCalls } = fakeDb([candidate])
    const { agent } = agentWithDigest("sha256:ccc")
    const enqueueDeploy = mock<RedeployTrigger>(async () => ({
      jobId: "job-2",
    }))

    const result = await runImageUpdateWatchOnce(db, agent, {
      enqueueDeploy,
    })

    expect(result).toMatchObject({
      scanned: 1,
      baseline: 0,
      updated: 1,
      unchanged: 0,
      skipped: 0,
    })
    expect(updateCalls.length).toBe(0)

    expect(enqueueDeploy).toHaveBeenCalledTimes(1)
    const deployCalls = enqueueDeploy.mock.calls as unknown as Array<
      Parameters<RedeployTrigger>
    >
    expect(deployCalls[0]?.[0]).toMatchObject({
      appId: "app-2",
      fromDigest: "sha256:aaa",
      toDigest: "sha256:ccc",
      previousStatus: "running",
    })
  })

  test("app mid-deploy (building) is skipped — no digest lookup, no deploy", async () => {
    const candidate = app({
      status: "building",
      last_image_digest: "sha256:aaa",
    })
    const { db, updateCalls } = fakeDb([candidate])
    const { agent, registryImageDigest } = agentWithDigest("sha256:ccc")
    const enqueueDeploy = mock<RedeployTrigger>(async () => ({
      jobId: "job-1",
    }))

    const result = await runImageUpdateWatchOnce(db, agent, {
      enqueueDeploy,
    })

    expect(result).toMatchObject({ scanned: 1, updated: 0, skipped: 1 })
    expect(registryImageDigest).not.toHaveBeenCalled()
    expect(updateCalls.length).toBe(0)
    expect(enqueueDeploy).not.toHaveBeenCalled()
  })

  test("pending digest skips lookup and does not stack deploys", async () => {
    const candidate = app({
      last_image_digest: "sha256:aaa",
      pending_image_digest: "sha256:bbb",
    })
    const { db } = fakeDb([candidate])
    const { agent, registryImageDigest } = agentWithDigest("sha256:ccc")
    const enqueueDeploy = mock<RedeployTrigger>(async () => ({
      jobId: "job-1",
    }))

    const result = await runImageUpdateWatchOnce(db, agent, {
      enqueueDeploy,
    })

    expect(result).toMatchObject({ scanned: 1, updated: 0, skipped: 1 })
    expect(registryImageDigest).not.toHaveBeenCalled()
    expect(enqueueDeploy).not.toHaveBeenCalled()
  })
})
