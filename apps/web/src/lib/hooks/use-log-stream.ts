// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { apiFetch } from "../api"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ABSOLUTE_MAX_LINES = 10_000
const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3335"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LogLine {
  id: number
  text: string
  t?: number
  stream?: "stdout" | "stderr"
}

export type LogLevel = "all" | "info" | "warn" | "error"

// ---------------------------------------------------------------------------
// Level detection — pure helper, exported for tests
// ---------------------------------------------------------------------------

const ERROR_PATTERNS = [
  /\[ERROR\]/i,
  /ERROR:/i,
  /\bfatal\b/i,
  /\bpanic\b/i,
  // "err:" as a word (e.g. "read err: connection reset") — no trailing \b since ":" is non-word
  /\berr:/i,
  /\b(error|fatal)\b/i,
]

const WARN_PATTERNS = [/\[WARN\]/i, /WARN:/i, /\bwarn(ing)?\b/i]

const INFO_PATTERNS = [/\[INFO\]/i, /INFO:/i, /\binfo\b/i]

/**
 * Detects the log level of a line based on textual heuristics.
 * Returns "error" | "warn" | "info" (falls back to "info" for unknown lines).
 */
export function detectLevel(text: string): "error" | "warn" | "info" {
  for (const re of ERROR_PATTERNS) {
    if (re.test(text)) return "error"
  }
  for (const re of WARN_PATTERNS) {
    if (re.test(text)) return "warn"
  }
  // Default: treat as info (includes stdout, debug, trace, etc.)
  for (const re of INFO_PATTERNS) {
    if (re.test(text)) return "info"
  }
  return "info"
}

/**
 * Applies a level filter to a list of lines.
 * "all" is a no-op.
 */
export function filterByLevel(
  lines: ReadonlyArray<LogLine>,
  level: LogLevel,
): Array<LogLine> {
  if (level === "all") return lines as Array<LogLine>
  return lines.filter((l) => detectLevel(l.text) === level)
}

/**
 * Applies a case-insensitive text filter to a list of lines.
 * Empty query is a no-op.
 */
export function filterBySearch(
  lines: ReadonlyArray<LogLine>,
  query: string,
): Array<LogLine> {
  const q = query.trim().toLowerCase()
  if (!q) return lines as Array<LogLine>
  return lines.filter((l) => l.text.toLowerCase().includes(q))
}

// ---------------------------------------------------------------------------
// Parsing helper — attempts JSON {t, line} envelope; falls back to raw text
// ---------------------------------------------------------------------------

function parseLine(raw: string, fallbackT: number): LogLine & { _raw: string } {
  if (raw.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        "line" in parsed &&
        typeof (parsed as Record<string, unknown>)["line"] === "string"
      ) {
        const obj = parsed as Record<string, unknown>
        const t =
          typeof obj["t"] === "number"
            ? (obj["t"] as number)
            : fallbackT
        const stream =
          obj["stream"] === "stdout" || obj["stream"] === "stderr"
            ? (obj["stream"] as "stdout" | "stderr")
            : undefined
        return { id: 0, text: obj["line"] as string, t, stream, _raw: raw }
      }
    } catch {
      // not JSON — fall through
    }
  }
  return { id: 0, text: raw, t: fallbackT, _raw: raw }
}

// ---------------------------------------------------------------------------
// useLogStream
// ---------------------------------------------------------------------------

export interface UseLogStreamOptions {
  appId: string
  buildId?: string
  /** Maximum number of lines retained in memory. Defaults to ABSOLUTE_MAX_LINES. */
  maxLines?: number
}

export interface UseLogStreamResult {
  lines: Array<LogLine>
  connected: boolean
  error: string | null
}

interface RuntimeLogResponse {
  lines: Array<{
    t: number
    line: string
    stream?: "stdout" | "stderr"
  }>
  containerFound?: boolean
}

type FallbackResult =
  | { kind: "empty-runtime" }
  | { kind: "lines"; lines: Array<string> }

async function loadArchivedBuildLogs(
  appId: string,
  buildId: string,
): Promise<FallbackResult> {
  const path = `/apps/${appId}/logs?buildId=${encodeURIComponent(buildId)}`
  const res = await fetch(`${API_BASE}${path}`, { credentials: "include" })
  if (!res.ok) throw new Error(`Failed to load logs (${res.status})`)
  const text = await res.text()
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0)
  return { kind: "lines", lines }
}

async function loadRuntimeLogs(appId: string): Promise<FallbackResult> {
  const data = await apiFetch<RuntimeLogResponse>(`/apps/${appId}/runtime-logs`)
  if (data.containerFound === false && data.lines.length === 0) {
    return { kind: "empty-runtime" }
  }
  return {
    kind: "lines",
    lines: data.lines.map((entry) => JSON.stringify(entry)),
  }
}

export function useLogStream({
  appId,
  buildId,
  maxLines,
}: UseLogStreamOptions): UseLogStreamResult {
  const cap = Math.min(maxLines ?? ABSOLUTE_MAX_LINES, ABSOLUTE_MAX_LINES)

  const [lines, setLines] = React.useState<Array<LogLine>>([])
  const [connected, setConnected] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const counterRef = React.useRef(0)

  const appendLine = React.useCallback(
    (raw: string) => {
      setLines((prev) => {
        const id = ++counterRef.current
        const parsed = parseLine(raw, Date.now())
        const entry: LogLine = { ...parsed, id }
        const next = [...prev, entry]
        return next.length > cap ? next.slice(next.length - cap) : next
      })
    },
    [cap],
  )

  // When maxLines changes (user picks a smaller volume), trim existing lines
  React.useEffect(() => {
    setLines((prev) =>
      prev.length > cap ? prev.slice(prev.length - cap) : prev,
    )
  }, [cap])

  React.useEffect(() => {
    setLines([])
    setError(null)
    counterRef.current = 0

    const wsBase = API_BASE.replace(/^http/, "ws")
    const wsPath =
      buildId && buildId !== "latest"
        ? `${wsBase}/ws/apps/${appId}/build/${buildId}`
        : `${wsBase}/ws/apps/${appId}/logs`

    let ws: WebSocket
    let fallbackTriggered = false

    const triggerFallback = (): void => {
      setError(
        buildId && buildId !== "latest"
          ? "WebSocket unavailable — loading archived logs\u2026"
          : "WebSocket unavailable — loading recent runtime logs\u2026",
      )

      const loader =
        buildId && buildId !== "latest"
          ? loadArchivedBuildLogs(appId, buildId)
          : loadRuntimeLogs(appId)

      loader
        .then((result) => {
          if (result.kind === "empty-runtime") {
            setError("No runtime container found for this app")
            return
          }
          setError(null)
          setLines([])
          counterRef.current = 0
          for (const raw of result.lines) appendLine(raw)
        })
        .catch((err: unknown) => {
          const msg =
            err instanceof Error ? err.message : "Failed to load logs"
          setError(msg)
        })
    }

    try {
      ws = new WebSocket(wsPath)

      ws.onopen = () => {
        setConnected(true)
        setError(null)
      }

      ws.onmessage = (ev: MessageEvent<string>) => {
        const text =
          typeof ev.data === "string" ? ev.data : String(ev.data)
        if (text.includes('"type":"runtime.missing"')) {
          setError("No runtime container found for this app")
          return
        }
        appendLine(text)
      }

      ws.onerror = () => {
        if (!fallbackTriggered) {
          fallbackTriggered = true
          triggerFallback()
        }
      }

      ws.onclose = (ev) => {
        setConnected(false)
        if (!ev.wasClean && !fallbackTriggered) {
          fallbackTriggered = true
          triggerFallback()
        }
      }
    } catch {
      if (!fallbackTriggered) {
        fallbackTriggered = true
        triggerFallback()
      }
    }

    return () => {
      ws?.close()
    }
  }, [appId, buildId, appendLine])

  return { lines, connected, error }
}
