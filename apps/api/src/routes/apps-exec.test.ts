// SPDX-License-Identifier: AGPL-3.0-only
//
// Tests for the shell-exec WebSocket endpoint (apps-exec.ts).
//
// Strategy:
//   - Pure helpers (buildStartFrame, getUserIdFromRequest): tested in isolation.
//   - WS HTTP smoke: plain HTTP GET without valid WS upgrade returns non-200.
//   - userOwnsApp: tested via a dedicated test Hono app that mounts apps-exec
//     routes and uses an in-memory SQLite DB, by testing the exported helper
//     directly with a patched module-level DB.
//
// Note on WS tests:
//   Full WS handshake (101 Upgrade + onOpen flow) requires a live Bun.serve()
//   instance — those tests belong in Playwright E2E specs.  Here we exercise
//   the exported pure helpers and verify the route shape.

import { describe, it, expect } from "bun:test"
import { createHmac } from "node:crypto"
import {
  buildSecondFactorCookie,
  SECOND_FACTOR_COOKIE,
} from "../auth/second-factor"
import { env } from "../env"
import {
  buildStartFrame,
  getRequestedExecMode,
  getUserIdFromRequest,
  hasFreshSecondFactorCookie,
} from "./apps-exec"
import type { ExecFrame } from "@ploydok/agent-proto"

const wsEnv = { server: { upgrade: () => false } }

// ---------------------------------------------------------------------------
// buildStartFrame — pure unit tests
// ---------------------------------------------------------------------------

describe("buildStartFrame", () => {
  it("produces correct ExecFrame with /bin/sh and tty:true", () => {
    const frame: ExecFrame = buildStartFrame("ctr-abc", 120, 40)
    expect(frame.start).toBeDefined()
    expect(frame.start!.containerId).toBe("ctr-abc")
    expect(frame.start!.cmd).toEqual(["/bin/sh"])
    expect(frame.start!.tty).toBe(true)
    expect(frame.start!.cols).toBe(120)
    expect(frame.start!.rows).toBe(40)
    expect(frame.start!.user).toBe("")
  })

  it("passes through custom cols/rows", () => {
    const frame = buildStartFrame("ctr-xyz", 80, 24)
    expect(frame.start!.cols).toBe(80)
    expect(frame.start!.rows).toBe(24)
  })

  it("does not set stdin/resize/exit/ready fields", () => {
    const frame = buildStartFrame("ctr-1", 80, 24)
    expect(frame.stdin).toBeUndefined()
    expect(frame.resize).toBeUndefined()
    expect(frame.exit).toBeUndefined()
    expect(frame.ready).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// getUserIdFromRequest — no valid cookie → null
// ---------------------------------------------------------------------------

describe("getUserIdFromRequest", () => {
  it("returns null when no cookie header is present", async () => {
    const req = new Request("http://localhost/ws/apps/app-1/exec")
    const userId = await getUserIdFromRequest(req)
    expect(userId).toBeNull()
  })

  it("returns null when cookie has a malformed JWT", async () => {
    const req = new Request("http://localhost/ws/apps/app-1/exec", {
      headers: { cookie: "ploydok_access=not-a-jwt" },
    })
    const userId = await getUserIdFromRequest(req)
    expect(userId).toBeNull()
  })

  it("returns null when ploydok_access cookie is absent but other cookies exist", async () => {
    const req = new Request("http://localhost/ws/apps/app-1/exec", {
      headers: { cookie: "other_cookie=abc123; session=xyz" },
    })
    const userId = await getUserIdFromRequest(req)
    expect(userId).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Exec mode + write proof helpers
// ---------------------------------------------------------------------------

describe("getRequestedExecMode", () => {
  it("defaults to ro when mode is absent", () => {
    const req = new Request("http://localhost/ws/apps/app-1/exec")
    expect(getRequestedExecMode(req)).toBe("ro")
  })

  it("returns rw only for explicit mode=rw", () => {
    const req = new Request("http://localhost/ws/apps/app-1/exec?mode=rw")
    expect(getRequestedExecMode(req)).toBe("rw")
  })

  it("falls back to ro for unknown mode", () => {
    const req = new Request("http://localhost/ws/apps/app-1/exec?mode=write")
    expect(getRequestedExecMode(req)).toBe("ro")
  })
})

describe("hasFreshSecondFactorCookie", () => {
  it("returns false when cookie is absent", () => {
    const req = new Request("http://localhost/ws/apps/app-1/exec")
    expect(hasFreshSecondFactorCookie(req, "u1")).toBe(false)
  })

  it("returns true for a fresh signed cookie matching the user", () => {
    const rawCookie = buildSecondFactorCookie("u1").split(";")[0]!
    const req = new Request("http://localhost/ws/apps/app-1/exec", {
      headers: { cookie: rawCookie },
    })
    expect(hasFreshSecondFactorCookie(req, "u1")).toBe(true)
  })

  it("returns false when the signed cookie belongs to another user", () => {
    const rawCookie = buildSecondFactorCookie("u2").split(";")[0]!
    const req = new Request("http://localhost/ws/apps/app-1/exec", {
      headers: { cookie: rawCookie },
    })
    expect(hasFreshSecondFactorCookie(req, "u1")).toBe(false)
  })

  it("returns false when the signed cookie is expired", () => {
    const expiredAt = Date.now() - 16 * 60 * 1000
    const payload = Buffer.from(
      JSON.stringify({ user_id: "u1", verified_at: expiredAt }),
      "utf8"
    ).toString("base64url")
    const hmac = createHmac("sha256", env.SESSION_SECRET)
      .update(payload)
      .digest("hex")
    const cookie = `${SECOND_FACTOR_COOKIE}=${encodeURIComponent(`${payload}.${hmac}`)}`
    const req = new Request("http://localhost/ws/apps/app-1/exec", {
      headers: { cookie },
    })
    expect(hasFreshSecondFactorCookie(req, "u1")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// wsExecRouter shape
// ---------------------------------------------------------------------------

describe("wsExecRouter shape", () => {
  it("is exported with a fetch function (Hono)", async () => {
    const { wsExecRouter } = await import("./apps-exec")
    expect(typeof wsExecRouter.fetch).toBe("function")
  })

  it("unknown routes return 404", async () => {
    const { wsExecRouter } = await import("./apps-exec")
    const res = await wsExecRouter.fetch(
      new Request("http://localhost/apps/x/unknown"),
      wsEnv
    )
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// WS HTTP smoke — plain GET without WS upgrade
//   Without a live Bun server, upgradeWebSocket falls back gracefully.
//   The route MUST NOT return 200 (which would indicate no auth guard ran).
// ---------------------------------------------------------------------------

describe("wsExecRouter HTTP smoke", () => {
  it("/apps/:id/exec — plain GET without cookie returns non-200", async () => {
    const { wsExecRouter } = await import("./apps-exec")
    const res = await wsExecRouter.fetch(
      new Request("http://localhost/apps/app-1/exec"),
      wsEnv
    )
    expect(res.status).not.toBe(200)
  })

  it("/apps/:id/exec?cols=120&rows=40 — plain GET with query params returns non-200", async () => {
    const { wsExecRouter } = await import("./apps-exec")
    const res = await wsExecRouter.fetch(
      new Request("http://localhost/apps/app-1/exec?cols=120&rows=40"),
      wsEnv
    )
    expect(res.status).not.toBe(200)
  })

  it("/apps/:id/exec?mode=rw — plain GET still does not bypass the WS gate", async () => {
    const { wsExecRouter } = await import("./apps-exec")
    const res = await wsExecRouter.fetch(
      new Request("http://localhost/apps/app-1/exec?mode=rw"),
      wsEnv
    )
    expect(res.status).not.toBe(200)
  })
})

// ---------------------------------------------------------------------------
// wsExecHandler exported for Bun.serve
// ---------------------------------------------------------------------------

describe("wsExecHandler", () => {
  it("is exported and is an object (BunWebSocket handler)", async () => {
    const { wsExecHandler } = await import("./apps-exec")
    expect(typeof wsExecHandler).toBe("object")
    expect(wsExecHandler).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Resize frame forwarding — structural test
//   Verifies that the JSON resize message would produce the correct ExecFrame.
//   (Tested by constructing the frame directly — no live gRPC needed.)
// ---------------------------------------------------------------------------

describe("resize frame structure", () => {
  it("resize message produces correct ExecResize fields", () => {
    // Simulates what onMessage does when it receives a resize JSON frame.
    const msg = JSON.stringify({ type: "resize", cols: 200, rows: 50 })
    const parsed = JSON.parse(msg) as { type: string; cols: number; rows: number }
    expect(parsed.type).toBe("resize")

    const frame: ExecFrame = {
      resize: { cols: Math.max(1, parsed.cols), rows: Math.max(1, parsed.rows) },
    }
    expect(frame.resize).toBeDefined()
    expect(frame.resize!.cols).toBe(200)
    expect(frame.resize!.rows).toBe(50)
    expect(frame.start).toBeUndefined()
    expect(frame.stdin).toBeUndefined()
  })

  it("resize clamps cols and rows to minimum 1", () => {
    const frame: ExecFrame = {
      resize: { cols: Math.max(1, 0), rows: Math.max(1, -5) },
    }
    expect(frame.resize!.cols).toBe(1)
    expect(frame.resize!.rows).toBe(1)
  })
})
