// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, describe, expect, it } from "bun:test"
import { Hono } from "hono"
import { createRedis } from "@ploydok/db"
import { nanoid } from "nanoid"
import {
  createInvitationOwnerRateLimit,
  createInvitationRegisterRateLimit,
} from "./invitations-rate-limit"

function atomicRedis() {
  const counts = new Map<string, number>()
  return {
    eval: async (
      _script: string,
      _keyCount: number,
      key: string,
      _cutoff: number,
      _now: number,
      _member: string,
      max: number
    ) => {
      const count = counts.get(key) ?? 0
      if (count >= Number(max)) return [0, 0]
      counts.set(key, count + 1)
      return [1, Number(max) - count - 1]
    },
  }
}

describe("invitation rate limits", () => {
  it("atomically caps concurrent registration attempts", async () => {
    const app = new Hono<{ Variables: { user: { id: string } } }>()
    app.use(
      "/register",
      createInvitationRegisterRateLimit(atomicRedis() as never, {
        trustProxyHeaders: true,
      })
    )
    app.post("/register", (c) => c.json({ ok: true }))

    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        app.request("/register", {
          method: "POST",
          headers: { "x-forwarded-for": "192.0.2.1" },
        })
      )
    )
    expect(
      responses.filter((response) => response.status === 200)
    ).toHaveLength(10)
    expect(
      responses.filter((response) => response.status === 429)
    ).toHaveLength(10)
  })

  it("ignores spoofed forwarding headers unless proxy trust is configured", async () => {
    const app = new Hono()
    app.use(
      "/register",
      createInvitationRegisterRateLimit(atomicRedis() as never, {
        trustProxyHeaders: false,
      })
    )
    app.post("/register", (c) => c.json({ ok: true }))

    for (let index = 0; index < 3; index += 1) {
      expect(
        (
          await app.request("/register", {
            method: "POST",
            headers: { "x-forwarded-for": `192.0.2.${index}` },
          })
        ).status
      ).toBe(200)
    }
    expect(
      (
        await app.request("/register", {
          method: "POST",
          headers: { "x-forwarded-for": "198.51.100.99" },
        })
      ).status
    ).toBe(429)
  })

  it("limits authenticated owners to prevent SMTP relay abuse", async () => {
    const app = new Hono<{ Variables: { user: { id: string } } }>()
    app.use("/org/invite", async (c, next) => {
      c.set("user", { id: "owner-1" })
      await next()
    })
    app.use(
      "/org/invite",
      createInvitationOwnerRateLimit(atomicRedis() as never, {
        trustProxyHeaders: false,
      })
    )
    app.post("/org/invite", (c) => c.json({ ok: true }))

    const responses = await Promise.all(
      Array.from({ length: 25 }, () =>
        app.request("/org/invite", { method: "POST" })
      )
    )
    expect(
      responses.filter((response) => response.status === 200)
    ).toHaveLength(20)
    expect(
      responses.filter((response) => response.status === 429)
    ).toHaveLength(5)
  })
})

const TEST_REDIS_URL = Bun.env["PLOYDOK_TEST_REDIS_URL"]
describe.skipIf(!TEST_REDIS_URL)("invitation rate limits on Redis", () => {
  const redis = createRedis(TEST_REDIS_URL!)
  afterAll(async () => {
    await redis.quit()
  })

  it("atomically admits exactly the configured number under concurrency", async () => {
    const ip = `192.0.2.${Math.floor(Math.random() * 200) + 1}`
    const app = new Hono()
    app.use(
      "/register",
      createInvitationRegisterRateLimit(redis, { trustProxyHeaders: true })
    )
    app.post("/register", (c) => c.json({ request: nanoid() }))

    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        app.request("/register", {
          method: "POST",
          headers: { "x-forwarded-for": ip },
        })
      )
    )
    expect(responses.filter((response) => response.ok)).toHaveLength(10)
    expect(
      responses.filter((response) => response.status === 429)
    ).toHaveLength(10)
    await redis.del(`rl:invitation-register:ip:${ip}`)
  })
})
