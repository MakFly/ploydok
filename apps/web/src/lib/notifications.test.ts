// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from "bun:test"
import { notificationsReducer } from "./notifications"
import type { NotificationEvent, NotificationsState } from "./notifications"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(id: string): NotificationEvent {
  return {
    id,
    type: "build.started",
    message: `Event ${id}`,
    t: Date.now(),
  }
}

const connectedState: NotificationsState = {
  items: [],
  unreadCount: 0,
  lastReadAt: 0,
  hydrated: true,
  connected: true,
}

const disconnectedState: NotificationsState = {
  items: [],
  unreadCount: 0,
  lastReadAt: 0,
  hydrated: true,
  connected: false,
}

// ---------------------------------------------------------------------------
// push — unreadCount increments unconditionally regardless of `connected`
// ---------------------------------------------------------------------------

describe("notificationsReducer / push", () => {
  test("increments unreadCount when connected", () => {
    const next = notificationsReducer(connectedState, {
      type: "push",
      payload: makeEvent("e1"),
    })
    expect(next.unreadCount).toBe(1)
    expect(next.items).toHaveLength(1)
  })

  test("dedups a repeated id (SSE replay scenario)", () => {
    const e = makeEvent("replay-1")
    const afterFirst = notificationsReducer(connectedState, {
      type: "push",
      payload: e,
    })
    const afterDup = notificationsReducer(afterFirst, {
      type: "push",
      payload: e,
    })
    expect(afterDup).toBe(afterFirst)
    expect(afterDup.items).toHaveLength(1)
    expect(afterDup.unreadCount).toBe(1)
  })

  test("increments unreadCount when disconnected", () => {
    const next = notificationsReducer(disconnectedState, {
      type: "push",
      payload: makeEvent("e2"),
    })
    expect(next.unreadCount).toBe(1)
    expect(next.items).toHaveLength(1)
  })

  test("accumulates unreadCount across multiple pushes while disconnected", () => {
    let state = disconnectedState
    state = notificationsReducer(state, { type: "push", payload: makeEvent("a") })
    state = notificationsReducer(state, { type: "push", payload: makeEvent("b") })
    state = notificationsReducer(state, { type: "push", payload: makeEvent("c") })
    expect(state.unreadCount).toBe(3)
    expect(state.items).toHaveLength(3)
  })

  test("connected flag is preserved after push", () => {
    const next = notificationsReducer(connectedState, {
      type: "push",
      payload: makeEvent("e3"),
    })
    expect(next.connected).toBe(true)
  })

  test("disconnected flag is preserved after push", () => {
    const next = notificationsReducer(disconnectedState, {
      type: "push",
      payload: makeEvent("e4"),
    })
    expect(next.connected).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// push after disconnect — simulate the realistic sequence
// ---------------------------------------------------------------------------

describe("notificationsReducer / push after disconnect", () => {
  test("push after disconnect increments unreadCount (was broken before fix)", () => {
    let state = connectedState
    // Receive an event while connected.
    state = notificationsReducer(state, { type: "push", payload: makeEvent("c1") })
    expect(state.unreadCount).toBe(1)

    // Connection drops.
    state = notificationsReducer(state, { type: "disconnect" })
    expect(state.connected).toBe(false)
    expect(state.unreadCount).toBe(1) // unchanged by disconnect

    // Event arrives while disconnected.
    state = notificationsReducer(state, { type: "push", payload: makeEvent("c2") })
    // Must increment — previously this was gated on `state.connected` and would stay at 1.
    expect(state.unreadCount).toBe(2)
    expect(state.items).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// markAllRead
// ---------------------------------------------------------------------------

describe("notificationsReducer / markAllRead", () => {
  test("resets unreadCount to 0", () => {
    let state = connectedState
    state = notificationsReducer(state, { type: "push", payload: makeEvent("m1") })
    state = notificationsReducer(state, { type: "push", payload: makeEvent("m2") })
    state = notificationsReducer(state, { type: "markAllRead", at: Date.now() })
    expect(state.unreadCount).toBe(0)
    // Items are retained.
    expect(state.items).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// MAX_ITEMS cap
// ---------------------------------------------------------------------------

describe("notificationsReducer / MAX_ITEMS cap", () => {
  test("items list is capped at 20", () => {
    let state = disconnectedState
    for (let i = 0; i < 25; i++) {
      state = notificationsReducer(state, {
        type: "push",
        payload: makeEvent(`x${i}`),
      })
    }
    expect(state.items).toHaveLength(20)
    expect(state.unreadCount).toBe(25)
  })
})
