// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { detectLevel } from "../../lib/hooks/use-log-stream"
import type { LogLine as LogLineData } from "../../lib/hooks/use-log-stream"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HighlightSegment {
  text: string
  isMatch: boolean
}

// ---------------------------------------------------------------------------
// Helpers — exported for tests
// ---------------------------------------------------------------------------

/**
 * Splits `text` around case-insensitive matches of `query`.
 * Returns segments tagged with `isMatch: true` for matches.
 * Returns `[{ text, isMatch: false }]` when query is empty or blank.
 */
export function highlightMatches(
  text: string,
  query: string,
): Array<HighlightSegment> {
  const q = query.trim()
  if (!q) return [{ text, isMatch: false }]

  // Escape special regex characters to avoid runtime errors
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = new RegExp(escaped, "gi")

  const segments: Array<HighlightSegment> = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), isMatch: false })
    }
    segments.push({ text: match[0], isMatch: true })
    lastIndex = re.lastIndex
    // Guard against zero-length match infinite loop
    if (match[0].length === 0) re.lastIndex++
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), isMatch: false })
  }

  return segments
}

// Timestamp at start of line: HH:MM:SS.mmm or HH:MM:SS
const TIMESTAMP_PREFIX_RE = /^(\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+/

// Stack trace line: leading whitespace + "at "
const STACK_TRACE_RE = /^\s+at\s/

function formatTimestamp(t: number): string {
  const d = new Date(t)
  const hh = d.getHours().toString().padStart(2, "0")
  const mm = d.getMinutes().toString().padStart(2, "0")
  const ss = d.getSeconds().toString().padStart(2, "0")
  const ms = d.getMilliseconds().toString().padStart(3, "0")
  return `${hh}:${mm}:${ss}.${ms}`
}

function levelColorClass(level: "error" | "warn" | "info"): string {
  switch (level) {
    case "error":
      return "text-red-400"
    case "warn":
      return "text-amber-400"
    default:
      return "text-zinc-300"
  }
}

// ---------------------------------------------------------------------------
// HighlightedText — renders plain text or text with <mark> spans
// ---------------------------------------------------------------------------

function HighlightedText({
  text,
  query,
}: {
  text: string
  query: string
}): React.JSX.Element {
  const segments = highlightMatches(text, query)
  if (segments.length === 1 && !segments[0].isMatch) {
    return <>{text}</>
  }
  return (
    <>
      {segments.map((seg, i) =>
        seg.isMatch ? (
          <mark
            key={i}
            className="bg-yellow-500/30 text-yellow-100 rounded px-0.5"
          >
            {seg.text}
          </mark>
        ) : (
          <React.Fragment key={i}>{seg.text}</React.Fragment>
        ),
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// LogLine — memoized log line renderer
// ---------------------------------------------------------------------------

export interface LogLineProps {
  line: LogLineData
  search: string
}

export const LogLine = React.memo(function LogLineRow({
  line,
  search,
}: LogLineProps): React.JSX.Element {
  const level = detectLevel(line.text)
  const isError = level === "error"
  const isStackTrace = STACK_TRACE_RE.test(line.text)

  // Extract inline timestamp prefix from text (HH:MM:SS.mmm) if present.
  // We prefer the structured `t` field for the timestamp column.
  const inlineMatch = TIMESTAMP_PREFIX_RE.exec(line.text)
  const bodyText = inlineMatch ? line.text.slice(inlineMatch[0].length) : line.text

  const textColor = isStackTrace ? "text-zinc-400" : levelColorClass(level)
  const rowBg = isError ? "bg-red-500/5" : ""

  return (
    <div
      className={`flex items-start gap-2 px-4 py-px leading-6 whitespace-pre-wrap break-all ${rowBg}`}
      data-level={level}
    >
      {/* Timestamp column */}
      <span
        className="shrink-0 select-none text-zinc-500 tabular-nums w-[7.5rem] text-right"
        aria-hidden="true"
      >
        {line.t !== undefined
          ? formatTimestamp(line.t)
          : inlineMatch
            ? inlineMatch[1]
            : null}
      </span>

      {/* Level badge */}
      <span
        className={`shrink-0 select-none w-12 text-right font-semibold ${levelColorClass(level)}`}
        aria-hidden="true"
      >
        {level === "info" ? (
          <span className="text-zinc-500">INFO</span>
        ) : level === "warn" ? (
          <span className="text-amber-400">WARN</span>
        ) : (
          <span className="text-red-400">ERR</span>
        )}
      </span>

      {/* Body */}
      <span className={`flex-1 min-w-0 ${textColor} ${isStackTrace ? "text-xs pl-4" : ""}`}>
        <HighlightedText text={bodyText} query={search} />
      </span>
    </div>
  )
})
