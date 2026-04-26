// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from "bun:test"
import {
  checkRateLimit,
  decrementConcurrentSessions,
  incrementConcurrentSessions,
  type RateLimitStore,
} from "./rate-limit"

function fakeStore(): RateLimitStore & { snapshot: Map<string, number> } {
  const snap = new Map<string, number>()
  return {
    snapshot: snap,
    async incr(key) {
      const v = (snap.get(key) ?? 0) + 1
      snap.set(key, v)
      return v
    },
    async decr(key) {
      const v = (snap.get(key) ?? 0) - 1
      snap.set(key, v)
      return v
    },
    async expire(_key, _sec) {
      return 1
    },
  }
}

describe("checkRateLimit", () => {
  test("autorise dans la limite", async () => {
    const s = fakeStore()
    for (let i = 1; i <= 5; i++) {
      const r = await checkRateLimit(s, "k", 10, 60)
      expect(r.allowed).toBe(true)
      expect(r.current).toBe(i)
    }
  })

  test("refuse au-delà de la limite", async () => {
    const s = fakeStore()
    for (let i = 0; i < 10; i++) await checkRateLimit(s, "k", 10, 60)
    const over = await checkRateLimit(s, "k", 10, 60)
    expect(over.allowed).toBe(false)
    expect(over.current).toBe(11)
  })
})

describe("incrementConcurrentSessions", () => {
  test("ouvre 3 sessions max", async () => {
    const s = fakeStore()
    for (let i = 1; i <= 3; i++) {
      const r = await incrementConcurrentSessions(s, "u", 3, 3600)
      expect(r.allowed).toBe(true)
      expect(r.current).toBe(i)
    }
    const denied = await incrementConcurrentSessions(s, "u", 3, 3600)
    expect(denied.allowed).toBe(false)
    expect(s.snapshot.get("u")).toBe(3) // rollback
  })

  test("decrement libère une slot", async () => {
    const s = fakeStore()
    await incrementConcurrentSessions(s, "u", 3, 3600)
    await incrementConcurrentSessions(s, "u", 3, 3600)
    await incrementConcurrentSessions(s, "u", 3, 3600)
    let denied = await incrementConcurrentSessions(s, "u", 3, 3600)
    expect(denied.allowed).toBe(false)

    await decrementConcurrentSessions(s, "u")
    const ok = await incrementConcurrentSessions(s, "u", 3, 3600)
    expect(ok.allowed).toBe(true)
    expect(ok.current).toBe(3)
  })
})
