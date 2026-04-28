// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tests for Shell component pure logic.
 * We test WebSocket URL construction, close-reason mapping, and protocol
 * helpers in isolation — xterm.js is a DOM-only dependency and cannot run
 * under happy-dom in a monorepo bun test runner.
 */
import { describe, expect, it } from "bun:test"

// ---------------------------------------------------------------------------
// WebSocket URL construction (mirrors Shell.tsx logic)
// ---------------------------------------------------------------------------

function buildWsUrl(
  host: string,
  protocol: "http:" | "https:",
  appId: string,
  cols: number,
  rows: number,
  mode: "ro" | "rw" = "ro",
): string {
  const wsProtocol = protocol === "https:" ? "wss:" : "ws:"
  return `${wsProtocol}//${host}/ws/apps/${appId}/exec?cols=${cols}&rows=${rows}&mode=${mode}`
}

describe("Shell — WebSocket URL", () => {
  it("uses ws: when page is http:", () => {
    const url = buildWsUrl("localhost:5173", "http:", "abc", 80, 24)
    expect(url).toBe(
      "ws://localhost:5173/ws/apps/abc/exec?cols=80&rows=24&mode=ro"
    )
  })

  it("uses wss: when page is https:", () => {
    const url = buildWsUrl("app.example.com", "https:", "abc", 120, 30)
    expect(url).toBe(
      "wss://app.example.com/ws/apps/abc/exec?cols=120&rows=30&mode=ro"
    )
  })

  it("includes the appId in the path", () => {
    const url = buildWsUrl("localhost:5173", "http:", "my-app-id", 80, 24)
    expect(url).toContain("/ws/apps/my-app-id/exec")
  })

  it("forwards cols and rows as query params", () => {
    const url = buildWsUrl("localhost:5173", "http:", "abc", 132, 50)
    expect(url).toContain("cols=132")
    expect(url).toContain("rows=50")
  })

  it("forwards rw mode when write access is enabled", () => {
    const url = buildWsUrl("localhost:5173", "http:", "abc", 80, 24, "rw")
    expect(url).toContain("mode=rw")
  })
})

// ---------------------------------------------------------------------------
// Close-reason mapping (mirrors Shell.tsx closeReason())
// ---------------------------------------------------------------------------

function closeReason(code: number): string {
  switch (code) {
    case 4001:
      return "Unauthorized"
    case 4003:
      return "Write access requires a fresh second-factor check"
    case 4004:
      return "App not found or no running container"
    case 1001:
      return "Session expired (idle timeout)"
    case 1011:
      return "Internal error"
    default:
      return `Connection closed (code ${code})`
  }
}

describe("Shell — close reason mapping", () => {
  it("maps 4001 to Unauthorized", () => {
    expect(closeReason(4001)).toBe("Unauthorized")
  })

  it("maps 4004 to app not found message", () => {
    expect(closeReason(4004)).toBe("App not found or no running container")
  })

  it("maps 4003 to write proof required message", () => {
    expect(closeReason(4003)).toBe(
      "Write access requires a fresh second-factor check"
    )
  })

  it("maps 1001 to idle timeout message", () => {
    expect(closeReason(1001)).toBe("Session expired (idle timeout)")
  })

  it("maps 1011 to internal error", () => {
    expect(closeReason(1011)).toBe("Internal error")
  })

  it("returns generic message for unknown codes", () => {
    expect(closeReason(1006)).toBe("Connection closed (code 1006)")
  })

  it("normal exit code 1000 is not mapped (caller skips message)", () => {
    // 1000 is not in the switch — it returns the generic message;
    // in Shell.tsx the caller guards with `if (evt.code !== 1000)`.
    const reason = closeReason(1000)
    expect(typeof reason).toBe("string")
  })
})

// ---------------------------------------------------------------------------
// Resize JSON message format
// ---------------------------------------------------------------------------

describe("Shell — resize message", () => {
  function buildResizeMsg(cols: number, rows: number): string {
    return JSON.stringify({ type: "resize", cols, rows })
  }

  it("serialises a resize message correctly", () => {
    const msg = JSON.parse(buildResizeMsg(80, 24)) as {
      type: string
      cols: number
      rows: number
    }
    expect(msg.type).toBe("resize")
    expect(msg.cols).toBe(80)
    expect(msg.rows).toBe(24)
  })
})

// ---------------------------------------------------------------------------
// Server → client JSON message parsing
// ---------------------------------------------------------------------------

type ServerMsg =
  | { type: "ready" }
  | { type: "exit"; code: number }
  | { type: "error"; message: string }

function parseServerMsg(raw: string): ServerMsg | null {
  try {
    return JSON.parse(raw) as ServerMsg
  } catch {
    return null
  }
}

describe("Shell — server message parsing", () => {
  it("parses ready message", () => {
    const msg = parseServerMsg('{"type":"ready"}')
    expect(msg?.type).toBe("ready")
  })

  it("parses exit message with code", () => {
    const msg = parseServerMsg('{"type":"exit","code":0}') as {
      type: string
      code: number
    } | null
    expect(msg?.type).toBe("exit")
    expect(msg?.code).toBe(0)
  })

  it("parses error message", () => {
    const msg = parseServerMsg('{"type":"error","message":"container gone"}') as {
      type: string
      message: string
    } | null
    expect(msg?.type).toBe("error")
    expect(msg?.message).toBe("container gone")
  })

  it("returns null for malformed JSON", () => {
    expect(parseServerMsg("not json")).toBeNull()
  })
})
