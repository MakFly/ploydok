// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, mock, beforeEach } from "bun:test"

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that use them
// ---------------------------------------------------------------------------

const addMock = mock(async () => undefined)

mock.module("../worker/queues", () => ({
  deployQueue: {
    add: addMock,
    getJob: mock(async () => null),
  },
}))

const insertDeliveryMock = mock(async () => "delivery-id-123")
const markDeliveryCoalescedMock = mock(async () => undefined)

mock.module("../webhooks/deliveries", () => ({
  insertDelivery: insertDeliveryMock,
  markDeliveryCoalesced: markDeliveryCoalescedMock,
}))

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import { handlePushGeneric } from "./push"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb(apps: unknown[]) {
  return {
    select: mock(() => ({
      from: () => ({
        where: () => Promise.resolve(apps),
      }),
    })),
    insert: mock(() => ({
      values: () => Promise.resolve(),
    })),
  } as unknown as Parameters<typeof handlePushGeneric>[0]
}

const baseApp = {
  id: "app-123",
  auto_deploy_enabled: true,
  branch: "main",
  watch_paths: null,
  coalesce_pushes: false,
  deploy_on_tag: true,
  tag_pattern: "^v\\d+\\.\\d+\\.\\d+$",
}

// ---------------------------------------------------------------------------
// Tag push — accepted
// ---------------------------------------------------------------------------

describe("handlePushGeneric — tag push", () => {
  beforeEach(() => {
    addMock.mockClear()
    insertDeliveryMock.mockClear()
    markDeliveryCoalescedMock.mockClear()
  })

  it("enqueues a deploy job with kind=tag when tag matches pattern", async () => {
    const db = makeDb([baseApp])
    await handlePushGeneric(
      db,
      {
        provider: "github",
        repoFullName: "owner/repo",
        ref: "refs/tags/v1.2.0",
        branch: "refs/tags/v1.2.0",
        commitSha: "deadbeef",
        commitMessage: "release v1.2.0",
        authRef: "inst-42",
        payloadHash: "hash123",
      },
      "delivery-external-1",
    )

    expect(addMock).toHaveBeenCalledTimes(1)
    const addCall = addMock.mock.calls[0] as unknown as [string, Record<string, unknown>]
    const jobData = addCall[1]
    expect(jobData.kind).toBe("tag")
    expect(jobData.tag).toBe("v1.2.0")
    // Wave-2 contract: payload references a pre-created build row, not appId.
    expect(typeof jobData.buildId).toBe("string")
    expect(jobData.buildId).not.toBe("")
    expect(insertDeliveryMock).toHaveBeenCalledTimes(1)
    const insertCall = insertDeliveryMock.mock.calls[0] as unknown as [unknown, Record<string, unknown>]
    const deliveryRow = insertCall[1]
    expect(deliveryRow.decision).toBe("enqueued")
  })

  it("skips deploy and records skipped_tag_disabled when deploy_on_tag=false", async () => {
    const db = makeDb([{ ...baseApp, deploy_on_tag: false }])
    await handlePushGeneric(
      db,
      {
        provider: "github",
        repoFullName: "owner/repo",
        ref: "refs/tags/v1.2.0",
        branch: "refs/tags/v1.2.0",
        commitSha: "deadbeef",
        commitMessage: "release v1.2.0",
        authRef: "inst-42",
        payloadHash: "hash123",
      },
      "delivery-external-2",
    )

    expect(addMock).toHaveBeenCalledTimes(0)
    const insertCall2 = insertDeliveryMock.mock.calls[0] as unknown as [unknown, Record<string, unknown>]
    expect(insertCall2[1].decision).toBe("skipped_tag_disabled")
  })

  it("skips deploy and records skipped_tag_pattern when tag does not match pattern", async () => {
    const db = makeDb([baseApp])
    await handlePushGeneric(
      db,
      {
        provider: "github",
        repoFullName: "owner/repo",
        ref: "refs/tags/release-2024",
        branch: "refs/tags/release-2024",
        commitSha: "deadbeef",
        commitMessage: "release",
        authRef: "inst-42",
        payloadHash: "hash456",
      },
      "delivery-external-3",
    )

    expect(addMock).toHaveBeenCalledTimes(0)
    const insertCall3 = insertDeliveryMock.mock.calls[0] as unknown as [unknown, Record<string, unknown>]
    expect(insertCall3[1].decision).toBe("skipped_tag_pattern")
  })

  it("enqueues a branch deploy (no kind field) for non-tag pushes", async () => {
    const db = makeDb([baseApp])
    await handlePushGeneric(
      db,
      {
        provider: "github",
        repoFullName: "owner/repo",
        ref: "refs/heads/main",
        branch: "main",
        commitSha: "cafebabe",
        commitMessage: "feat: normal push",
        authRef: "inst-42",
        payloadHash: "hashbranch",
      },
      "delivery-external-4",
    )

    expect(addMock).toHaveBeenCalledTimes(1)
    const addCall4 = addMock.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(addCall4[1].kind).toBeUndefined()
    expect(addCall4[1].tag).toBeUndefined()
  })
})
