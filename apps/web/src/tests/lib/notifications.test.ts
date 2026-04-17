// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test"
import {
  
  
  notificationsReducer
} from "../../lib/notifications"
import type {NotificationEvent, NotificationsState} from "../../lib/notifications";

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

const connected: NotificationsState = {
  items: [],
  unreadCount: 0,
  connected: true,
}

const disconnected: NotificationsState = {
  items: [],
  unreadCount: 0,
  connected: false,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("notificationsReducer", () => {
  it("connect sets connected to true", () => {
    const next = notificationsReducer(disconnected, { type: "connect" })
    expect(next.connected).toBe(true)
  })

  it("disconnect sets connected to false", () => {
    const next = notificationsReducer(connected, { type: "disconnect" })
    expect(next.connected).toBe(false)
  })

  it("push prepends item and increments unreadCount when connected", () => {
    const ev = makeEvent("a")
    const next = notificationsReducer(connected, { type: "push", payload: ev })
    expect(next.items[0]).toEqual(ev)
    expect(next.items.length).toBe(1)
    expect(next.unreadCount).toBe(1)
  })

  it("push increments unreadCount even when disconnected (always-increment policy)", () => {
    const ev = makeEvent("b")
    const next = notificationsReducer(disconnected, { type: "push", payload: ev })
    expect(next.items[0]).toEqual(ev)
    expect(next.unreadCount).toBe(1)
  })

  it("push keeps items ordered most-recent first", () => {
    const ev1 = makeEvent("first")
    const ev2 = makeEvent("second")
    let state = notificationsReducer(connected, { type: "push", payload: ev1 })
    state = notificationsReducer(state, { type: "push", payload: ev2 })
    expect(state.items[0].id).toBe("second")
    expect(state.items[1].id).toBe("first")
  })

  it("push caps items at 20, dropping the oldest", () => {
    let state = connected
    for (let i = 0; i < 25; i++) {
      state = notificationsReducer(state, {
        type: "push",
        payload: makeEvent(String(i)),
      })
    }
    expect(state.items.length).toBe(20)
    // Most recent is last pushed (id "24")
    expect(state.items[0].id).toBe("24")
    // Oldest kept is id "5" (25 pushed, 20 kept, drop 0-4)
    expect(state.items[19].id).toBe("5")
  })

  it("markAllRead resets unreadCount to 0", () => {
    let state = connected
    state = notificationsReducer(state, {
      type: "push",
      payload: makeEvent("x"),
    })
    state = notificationsReducer(state, {
      type: "push",
      payload: makeEvent("y"),
    })
    expect(state.unreadCount).toBe(2)

    const next = notificationsReducer(state, { type: "markAllRead" })
    expect(next.unreadCount).toBe(0)
    expect(next.items.length).toBe(2) // items untouched
  })

  it("clear empties items and resets unreadCount", () => {
    let state = connected
    state = notificationsReducer(state, {
      type: "push",
      payload: makeEvent("z"),
    })
    const next = notificationsReducer(state, { type: "clear" })
    expect(next.items).toEqual([])
    expect(next.unreadCount).toBe(0)
    expect(next.connected).toBe(true) // connected flag untouched
  })
})
