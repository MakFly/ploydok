// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test"
import { createInProcessKeyedLock } from "./app-deploy-lock"

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe("createInProcessKeyedLock", () => {
  it("serializes tasks for the same key", async () => {
    const withLock = createInProcessKeyedLock()
    const firstGate = deferred()
    const events: string[] = []

    const first = withLock("app-1", async () => {
      events.push("first:start")
      await firstGate.promise
      events.push("first:end")
    })

    const second = withLock("app-1", async () => {
      events.push("second:start")
    })

    await tick()
    expect(events).toEqual(["first:start"])

    firstGate.resolve()
    await Promise.all([first, second])
    expect(events).toEqual(["first:start", "first:end", "second:start"])
  })

  it("allows tasks for different keys to overlap", async () => {
    const withLock = createInProcessKeyedLock()
    const gate = deferred()
    let active = 0
    let maxActive = 0

    const run = (key: string) =>
      withLock(key, async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await gate.promise
        active -= 1
      })

    const first = run("app-1")
    const second = run("app-2")

    await tick()
    expect(maxActive).toBe(2)

    gate.resolve()
    await Promise.all([first, second])
  })
})
