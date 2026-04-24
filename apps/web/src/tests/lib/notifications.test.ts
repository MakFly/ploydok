// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test"
import { resolveNotificationHref } from "../../lib/notification-destinations"
import { notificationsReducer } from "../../lib/notifications"
import type { NotificationEvent, NotificationsState } from "../../lib/notifications"

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
  lastReadAt: 0,
  hydrated: true,
  connected: true,
}

const disconnected: NotificationsState = {
  items: [],
  unreadCount: 0,
  lastReadAt: 0,
  hydrated: true,
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

  it("push caps items at 20 but keeps unreadCount unbounded", () => {
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
    // unreadCount must NOT be capped to items.length — the badge keeps
    // counting every push, even once older items have rolled off the list.
    expect(state.unreadCount).toBe(25)
  })

  it("push after disconnect still increments unreadCount", () => {
    let state = connected
    state = notificationsReducer(state, {
      type: "push",
      payload: makeEvent("c1"),
    })
    expect(state.unreadCount).toBe(1)

    state = notificationsReducer(state, { type: "disconnect" })
    expect(state.connected).toBe(false)
    expect(state.unreadCount).toBe(1)

    state = notificationsReducer(state, {
      type: "push",
      payload: makeEvent("c2"),
    })
    // Must increment — a previous bug gated this on state.connected.
    expect(state.unreadCount).toBe(2)
    expect(state.items.length).toBe(2)
  })

  it("push dedups by id (SSE replay scenario)", () => {
    const ev = makeEvent("replay-1")
    const after1 = notificationsReducer(connected, { type: "push", payload: ev })
    const after2 = notificationsReducer(after1, { type: "push", payload: ev })
    expect(after2).toBe(after1)
    expect(after2.items).toHaveLength(1)
    expect(after2.unreadCount).toBe(1)
  })

  it("hydrate recomputes unreadCount against the server cursor", () => {
    let state = connected
    const now = Date.now()
    state = notificationsReducer(state, {
      type: "push",
      payload: { ...makeEvent("old"), t: now - 10_000 },
    })
    state = notificationsReducer(state, {
      type: "push",
      payload: { ...makeEvent("new"), t: now },
    })
    expect(state.unreadCount).toBe(2)

    const hydrated = notificationsReducer(state, {
      type: "hydrate",
      lastReadAt: now - 5_000,
    })
    expect(hydrated.hydrated).toBe(true)
    expect(hydrated.lastReadAt).toBe(now - 5_000)
    // Only the event with t=now is strictly newer than the cursor.
    expect(hydrated.unreadCount).toBe(1)
  })

  it("markAllReadRollback restores lastReadAt and recomputes unreadCount", () => {
    let state = connected
    const now = Date.now()
    state = notificationsReducer(state, {
      type: "push",
      payload: { ...makeEvent("e1"), t: now - 1000 },
    })
    state = notificationsReducer(state, {
      type: "push",
      payload: { ...makeEvent("e2"), t: now },
    })
    // Optimistic mark-all-read.
    state = notificationsReducer(state, { type: "markAllRead", at: now + 1 })
    expect(state.unreadCount).toBe(0)

    // Rollback to cursor=0 (nothing previously read).
    const rolled = notificationsReducer(state, {
      type: "markAllReadRollback",
      lastReadAt: 0,
    })
    expect(rolled.lastReadAt).toBe(0)
    expect(rolled.unreadCount).toBe(2)
    expect(rolled.items).toHaveLength(2)
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

    const next = notificationsReducer(state, { type: "markAllRead", at: Date.now() })
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

describe("resolveNotificationHref", () => {
  it("links build notifications with a build id to the deployments drawer", () => {
    const href = resolveNotificationHref(
      {
        ...makeEvent("build-link"),
        appId: "app_123",
        buildId: "build/with space",
      },
      "acme",
    )

    expect(href).toBe("/orgs/acme/apps/app_123/deployments?build=build%2Fwith%20space")
  })

  it("links build notifications without a build id to deployments", () => {
    const href = resolveNotificationHref(
      {
        ...makeEvent("build-list"),
        appId: "app_123",
      },
      "acme",
    )

    expect(href).toBe("/orgs/acme/apps/app_123/deployments")
  })

  it("links container health notifications to app overview", () => {
    const href = resolveNotificationHref(
      {
        ...makeEvent("container-link"),
        type: "container.health",
        appId: "app_123",
      },
      "acme",
    )

    expect(href).toBe("/orgs/acme/apps/app_123/overview")
  })

  it("links provider sync notifications to git provider settings", () => {
    const href = resolveNotificationHref(
      {
        ...makeEvent("provider-link"),
        type: "provider.sync.failed",
      },
      null,
    )

    expect(href).toBe("/settings/git-providers")
  })

  it("does not invent app-scoped links without an org slug or app id", () => {
    expect(resolveNotificationHref(makeEvent("missing-app"), "acme")).toBeNull()
    expect(
      resolveNotificationHref(
        {
          ...makeEvent("missing-org"),
          appId: "app_123",
        },
        null,
      ),
    ).toBeNull()
  })
})
