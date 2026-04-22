// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, mock } from "bun:test"
import type { ChannelRow } from "./types"
import type { Db } from "@ploydok/db"
import type { Redis } from "@ploydok/db"

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeChannel(overrides: Partial<ChannelRow> = {}): ChannelRow {
  return {
    id: "ch1",
    owner_id: "user1",
    project_id: null,
    kind: "discord",
    name: "Test",
    config: { kind: "discord", webhook_url: "https://discord.com/api/webhooks/test/tok" },
    events: ["build.succeeded"],
    enabled: true,
    last_error: null,
    last_sent_at: null,
    created_at: new Date(),
    ...overrides,
  }
}

function makeDb(channels: ChannelRow[]): Db {
  return {
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() => Promise.resolve(channels)),
      })),
    })),
    update: mock(() => ({
      set: mock(() => ({
        where: mock(() => Promise.resolve([])),
      })),
    })),
  } as unknown as Db
}

function makeRedis(nx: string | null = "OK"): Redis {
  return { set: mock(() => Promise.resolve(nx)) } as unknown as Redis
}

// ── Tests using dispatch directly with adapter injection ──────────────────────

// We test the filtering + dedup logic using the actual dispatch function
// but with controlled DB/Redis mocks.

describe("dispatch filtering", () => {
  it("skips channels whose events don't match the fired event", async () => {
    // Channel listens to 'build.failed' only
    const ch = makeChannel({ events: ["build.failed"] })
    const db = makeDb([ch])
    const redis = makeRedis()

    const { dispatch } = await import("./index")

    // Fire 'build.succeeded' — should not reach the adapter at all.
    // We verify by checking no update was called (update is only called after send).
    const updateMock = (db.update as ReturnType<typeof mock>)
    await dispatch(db, redis, "build.succeeded", { appId: "a", appName: "A" }, { userId: "user1" })

    // Redis.set should NOT have been called (no matching channels → early return before dedup)
    const redisMock = (redis.set as ReturnType<typeof mock>)
    expect(redisMock).not.toHaveBeenCalled()
  })

  it("deduplicates: skips send when Redis NX returns null (already set)", async () => {
    const ch = makeChannel({ events: ["deploy.succeeded"] })
    const db = makeDb([ch])
    // Redis returns null → key already exists → dedup
    const redis = makeRedis(null)

    const { dispatch } = await import("./index")
    await dispatch(db, redis, "deploy.succeeded", { appId: "a", appName: "A", commitSha: "abc" }, { userId: "user1" })

    // Update should NOT have been called since we deduped
    const updateMock = (db.update as ReturnType<typeof mock>)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it("proceeds to send when Redis NX returns 'OK' (new key)", async () => {
    const ch = makeChannel({ events: ["build.succeeded"] })
    const db = makeDb([ch])
    const redis = makeRedis("OK")

    const { dispatch } = await import("./index")
    // This will call the discord adapter which will try to fetch — that's OK,
    // it'll fail but we just want to verify the update was attempted.
    await dispatch(db, redis, "build.succeeded", { appId: "a", appName: "A" }, { userId: "user1" })

    const updateMock = (db.update as ReturnType<typeof mock>)
    expect(updateMock).toHaveBeenCalled()
  })

  it("dispatches to channels with matching events and skips non-matching", async () => {
    const matching = makeChannel({ id: "ch1", events: ["build.succeeded"] })
    const nonMatching = makeChannel({ id: "ch2", events: ["build.failed"] })
    const db = makeDb([matching, nonMatching])
    const redis = makeRedis("OK")

    const { dispatch } = await import("./index")
    await dispatch(db, redis, "build.succeeded", { appId: "a", appName: "A" }, { userId: "user1" })

    // Only one call to update (for ch1), not two
    const updateMock = (db.update as ReturnType<typeof mock>)
    // update is called once for ch1 (the matching channel)
    expect(updateMock).toHaveBeenCalledTimes(1)
  })
})
