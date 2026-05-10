// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { apiFetch } from "../api"
import { apiBaseUrl, apiWebSocketBaseUrl } from "../api/base"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ABSOLUTE_MAX_LINES = 10_000

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LogLine {
  id: number
  text: string
  t?: number
  stream?: "stdout" | "stderr"
}

export type LogLevel = "all" | "debug" | "info" | "warn" | "error"
export type LogSeverity = Exclude<LogLevel, "all">

// ---------------------------------------------------------------------------
// Level detection — pure helper, exported for tests
// ---------------------------------------------------------------------------

const EXPLICIT_LEVEL_RE =
  /^(?:PHP\s+)?\[(debug|info|notice|warn|warning|error|critical|alert|emergency)\]/i

const ERROR_PATTERNS = [
  /\[ERROR\]/i,
  /\[CRITICAL\]/i,
  /\[ALERT\]/i,
  /\[EMERGENCY\]/i,
  /ERROR:/i,
  /CRITICAL:/i,
  /\bfatal\b/i,
  /\bpanic\b/i,
  // "err:" as a word (e.g. "read err: connection reset") — no trailing \b since ":" is non-word
  /\berr:/i,
  /\b(error|fatal|critical)\b/i,
]

const WARN_PATTERNS = [/\[WARN\]/i, /WARN:/i, /\bwarn(ing)?\b/i]

const DEBUG_PATTERNS = [/\[DEBUG\]/i, /DEBUG:/i, /\bdebug\b/i]

const INFO_PATTERNS = [/\[INFO\]/i, /INFO:/i, /\binfo\b/i]

function detectExplicitLevel(text: string): LogSeverity | null {
  const match = EXPLICIT_LEVEL_RE.exec(text.trim())
  const marker = match?.[1]?.toLowerCase()
  switch (marker) {
    case "debug":
      return "debug"
    case "warn":
    case "warning":
      return "warn"
    case "error":
    case "critical":
    case "alert":
    case "emergency":
      return "error"
    case "info":
    case "notice":
      return "info"
    default:
      return null
  }
}

/**
 * Detects the log level of a line based on textual heuristics.
 * Explicit level markers win over message text; unknown lines fall back to info.
 */
export function detectLevel(text: string): LogSeverity {
  const explicitLevel = detectExplicitLevel(text)
  if (explicitLevel) return explicitLevel

  for (const re of ERROR_PATTERNS) {
    if (re.test(text)) return "error"
  }
  for (const re of WARN_PATTERNS) {
    if (re.test(text)) return "warn"
  }
  for (const re of DEBUG_PATTERNS) {
    if (re.test(text)) return "debug"
  }
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
  level: LogLevel
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
  query: string
): Array<LogLine> {
  const q = query.trim().toLowerCase()
  if (!q) return lines as Array<LogLine>
  return lines.filter((l) => l.text.toLowerCase().includes(q))
}

// ---------------------------------------------------------------------------
// Parsing helper — attempts JSON {t, line} envelope; falls back to raw text
// ---------------------------------------------------------------------------

type ParsedLogLine = LogLine & { _raw: string }

interface FastCgiChunk {
  requestId: string | null
  payload: string
  complete: boolean
}

interface PendingFastCgiChunk {
  requestId: string | null
  envelope: ParsedLogLine
  payload: string
}

function parseLineEnvelope(raw: string, fallbackT: number): ParsedLogLine {
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
        const t = typeof obj["t"] === "number" ? obj["t"] : fallbackT
        const stream =
          obj["stream"] === "stdout" || obj["stream"] === "stderr"
            ? obj["stream"]
            : undefined
        return { id: 0, text: obj["line"] as string, t, stream, _raw: raw }
      }
    } catch {
      // not JSON — fall through
    }
  }
  return { id: 0, text: raw, t: fallbackT, _raw: raw }
}

const FASTCGI_STDERR_MARKER = 'FastCGI sent in stderr: "'
const FASTCGI_STDERR_SUFFIX = '" while '
const PHP_MESSAGE_SPLIT_RE = /;\s*PHP message:\s*/g

function parseFastCgiChunk(text: string): FastCgiChunk | null {
  const markerIndex = text.indexOf(FASTCGI_STDERR_MARKER)
  if (markerIndex === -1) return null

  const payloadStart = markerIndex + FASTCGI_STDERR_MARKER.length
  const suffixIndex = text.lastIndexOf(FASTCGI_STDERR_SUFFIX)
  const complete = suffixIndex > payloadStart
  const payloadEnd = complete ? suffixIndex : text.length
  const payload = text.slice(payloadStart, payloadEnd)

  if (payload.trim().length === 0) return null

  const requestMatch = /\*(\d+)\s+$/.exec(text.slice(0, markerIndex))
  return {
    requestId: requestMatch?.[1] ?? null,
    payload,
    complete,
  }
}

function splitPhpMessages(
  text: string,
  options?: { allowLeadingText?: boolean }
): Array<string> | null {
  const payloadText = text.trim()
  if (
    !payloadText.includes("PHP message:") ||
    (!options?.allowLeadingText && !payloadText.startsWith("PHP message:"))
  ) {
    return null
  }

  const payload = payloadText.replace(/^PHP message:\s*/, "")
  const messages = payload
    .split(PHP_MESSAGE_SPLIT_RE)
    .map((part) => part.trim().replace(/;$/, "").trim())
    .filter(Boolean)

  if (messages.length === 0) return null
  return messages.map((message) => `PHP ${message}`)
}

function expandFastCgiPayload(
  envelope: ParsedLogLine,
  payload: string
): Array<ParsedLogLine> {
  return (
    splitPhpMessages(payload, { allowLeadingText: true }) ?? [envelope.text]
  ).map((text) => ({
    ...envelope,
    text,
  }))
}

function expandPlainLogEnvelope(envelope: ParsedLogLine): Array<ParsedLogLine> {
  return (splitPhpMessages(envelope.text) ?? [envelope.text]).map((text) => ({
    ...envelope,
    text,
  }))
}

function canAppendFastCgiChunk(
  pending: PendingFastCgiChunk,
  chunk: FastCgiChunk
): boolean {
  return (
    pending.requestId !== null &&
    chunk.requestId !== null &&
    pending.requestId === chunk.requestId
  )
}

export function createLogEntryNormalizer(): {
  append: (raw: string, fallbackT: number) => Array<ParsedLogLine>
  flush: () => Array<ParsedLogLine>
} {
  let pendingFastCgi: PendingFastCgiChunk | null = null

  const flush = (): Array<ParsedLogLine> => {
    if (!pendingFastCgi) return []
    const pending = pendingFastCgi
    pendingFastCgi = null
    return expandFastCgiPayload(pending.envelope, pending.payload)
  }

  return {
    append(raw: string, fallbackT: number): Array<ParsedLogLine> {
      const envelope = parseLineEnvelope(raw, fallbackT)
      const chunk = parseFastCgiChunk(envelope.text)

      if (!chunk) {
        return [...flush(), ...expandPlainLogEnvelope(envelope)]
      }

      if (pendingFastCgi && canAppendFastCgiChunk(pendingFastCgi, chunk)) {
        pendingFastCgi.payload += chunk.payload
        if (!chunk.complete) return []

        const pending = pendingFastCgi
        pendingFastCgi = null
        return expandFastCgiPayload(pending.envelope, pending.payload)
      }

      const flushed = flush()
      if (!chunk.complete) {
        pendingFastCgi = {
          requestId: chunk.requestId,
          envelope,
          payload: chunk.payload,
        }
        return flushed
      }

      return [...flushed, ...expandFastCgiPayload(envelope, chunk.payload)]
    },

    flush,
  }
}

function parseStatelessLogEnvelope(
  envelope: ParsedLogLine
): Array<ParsedLogLine> {
  const chunk = parseFastCgiChunk(envelope.text)
  if (chunk) {
    return (
      splitPhpMessages(chunk.payload, { allowLeadingText: true }) ?? [
        envelope.text,
      ]
    ).map((text) => ({
      ...envelope,
      text,
    }))
  }

  return expandPlainLogEnvelope(envelope)
}

export function parseLogEntries(
  raw: string,
  fallbackT: number
): Array<ParsedLogLine> {
  return parseStatelessLogEnvelope(parseLineEnvelope(raw, fallbackT))
}

// ---------------------------------------------------------------------------
// useLogStream
// ---------------------------------------------------------------------------

export interface UseLogStreamOptions {
  appId: string
  buildId?: string
  /** Load the persisted build log file without opening a live WebSocket. */
  archiveOnly?: boolean
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
  buildId: string
): Promise<FallbackResult> {
  const path = `/apps/${appId}/logs?buildId=${encodeURIComponent(buildId)}`
  const res = await fetch(`${apiBaseUrl()}${path}`, { credentials: "include" })
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
  archiveOnly,
  maxLines,
}: UseLogStreamOptions): UseLogStreamResult {
  const cap = Math.min(maxLines ?? ABSOLUTE_MAX_LINES, ABSOLUTE_MAX_LINES)

  const [lines, setLines] = React.useState<Array<LogLine>>([])
  const [connected, setConnected] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const counterRef = React.useRef(0)
  const normalizerRef = React.useRef(createLogEntryNormalizer())

  const appendParsedEntries = React.useCallback(
    (parsedEntries: Array<ParsedLogLine>) => {
      if (parsedEntries.length === 0) return
      setLines((prev) => {
        const entries = parsedEntries.map((parsed) => {
          const id = ++counterRef.current
          const entry: LogLine = { ...parsed, id }
          return entry
        })
        const next = [...prev, ...entries]
        return next.length > cap ? next.slice(next.length - cap) : next
      })
    },
    [cap]
  )

  const appendLine = React.useCallback(
    (raw: string) => {
      appendParsedEntries(normalizerRef.current.append(raw, Date.now()))
    },
    [appendParsedEntries]
  )

  const flushPendingLines = React.useCallback(() => {
    appendParsedEntries(normalizerRef.current.flush())
  }, [appendParsedEntries])

  // When maxLines changes (user picks a smaller volume), trim existing lines
  React.useEffect(() => {
    setLines((prev) =>
      prev.length > cap ? prev.slice(prev.length - cap) : prev
    )
  }, [cap])

  React.useEffect(() => {
    setLines([])
    setError(null)
    setConnected(false)
    counterRef.current = 0
    normalizerRef.current = createLogEntryNormalizer()

    if (archiveOnly && buildId && buildId !== "latest") {
      let cancelled = false
      loadArchivedBuildLogs(appId, buildId)
        .then((result) => {
          if (cancelled) return
          if (result.kind !== "lines") return
          setError(null)
          setLines([])
          counterRef.current = 0
          normalizerRef.current = createLogEntryNormalizer()
          for (const raw of result.lines) appendLine(raw)
          flushPendingLines()
        })
        .catch((err: unknown) => {
          if (cancelled) return
          const msg = err instanceof Error ? err.message : "Failed to load logs"
          setError(msg)
        })
      return () => {
        cancelled = true
      }
    }

    const wsBase = apiWebSocketBaseUrl()
    const wsPath =
      buildId && buildId !== "latest"
        ? `${wsBase}/ws/apps/${appId}/build/${buildId}`
        : `${wsBase}/ws/apps/${appId}/logs`

    let ws: WebSocket
    let fallbackTriggered = false
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null

    const triggerFallback = (): void => {
      setError(
        buildId && buildId !== "latest"
          ? "WebSocket unavailable — loading archived logs\u2026"
          : "WebSocket unavailable — loading recent runtime logs\u2026"
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
          normalizerRef.current = createLogEntryNormalizer()
          for (const raw of result.lines) appendLine(raw)
          flushPendingLines()
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : "Failed to load logs"
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
        const text = typeof ev.data === "string" ? ev.data : String(ev.data)
        if (text.includes('"type":"runtime.missing"')) {
          setError("No runtime container found for this app")
          return
        }
        appendLine(text)
      }

      // Defer fallback by 1s so the API has a chance to persist log_path
      // for builds that just finished (race between WS close and DB write).
      const scheduleFallback = (): void => {
        if (fallbackTriggered) return
        fallbackTriggered = true
        if (fallbackTimer) clearTimeout(fallbackTimer)
        fallbackTimer = setTimeout(() => {
          fallbackTimer = null
          triggerFallback()
        }, 1_000)
      }

      ws.onerror = scheduleFallback

      ws.onclose = (ev) => {
        setConnected(false)
        flushPendingLines()
        if (!ev.wasClean) scheduleFallback()
      }
    } catch {
      if (!fallbackTriggered) {
        fallbackTriggered = true
        triggerFallback()
      }
    }

    return () => {
      if (fallbackTimer) clearTimeout(fallbackTimer)
      ws?.close()
    }
  }, [appId, buildId, archiveOnly, appendLine, flushPendingLines])

  return { lines, connected, error }
}
