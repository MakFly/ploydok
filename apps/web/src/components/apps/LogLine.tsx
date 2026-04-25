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
  query: string
): Array<HighlightSegment> {
  const q = query.trim()
  if (!q) return [{ text, isMatch: false }]

  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = new RegExp(escaped, "gi")

  const segments: Array<HighlightSegment> = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        text: text.slice(lastIndex, match.index),
        isMatch: false,
      })
    }
    segments.push({ text: match[0], isMatch: true })
    lastIndex = re.lastIndex
    if (match[0].length === 0) re.lastIndex++
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), isMatch: false })
  }

  return segments
}

const TIMESTAMP_PREFIX_RE = /^(\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+/
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
// HighlightedText
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
            className="rounded bg-yellow-500/30 px-0.5 text-yellow-100"
          >
            {seg.text}
          </mark>
        ) : (
          <React.Fragment key={i}>{seg.text}</React.Fragment>
        )
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
  /** Word-wrap long lines. When false, lines truncate horizontally with scroll. */
  wrap?: boolean
  /** Show the timestamp column. */
  showTimestamps?: boolean
  /** Optional 1-based line number for the gutter. */
  lineNumber?: number
}

export const LogLine = React.memo(function LogLineRow({
  line,
  search,
  wrap = true,
  showTimestamps = true,
  lineNumber,
}: LogLineProps): React.JSX.Element {
  const level = detectLevel(line.text)
  const isError = level === "error"
  const isWarn = level === "warn"
  const isStackTrace = STACK_TRACE_RE.test(line.text)

  const inlineMatch = TIMESTAMP_PREFIX_RE.exec(line.text)
  const bodyText = inlineMatch
    ? line.text.slice(inlineMatch[0].length)
    : line.text

  const textColor = isStackTrace ? "text-zinc-400" : levelColorClass(level)
  const rowBg = isError
    ? "bg-red-500/5 hover:bg-red-500/10"
    : isWarn
      ? "hover:bg-amber-500/5"
      : "hover:bg-zinc-900/60"
  const wrapCls = wrap
    ? "whitespace-pre-wrap break-all"
    : "whitespace-pre overflow-hidden"

  return (
    <div
      className={`group/line flex items-start gap-2 px-4 py-px leading-6 ${wrapCls} ${rowBg} transition-colors`}
      data-level={level}
      data-line-id={line.id}
    >
      {lineNumber !== undefined && (
        <span
          className="w-10 shrink-0 text-right text-zinc-700 tabular-nums select-none group-hover/line:text-zinc-500"
          aria-hidden="true"
        >
          {lineNumber}
        </span>
      )}

      {showTimestamps && (
        <span
          className="w-[7.5rem] shrink-0 text-right text-zinc-500 tabular-nums select-none"
          aria-hidden="true"
        >
          {line.t !== undefined
            ? formatTimestamp(line.t)
            : inlineMatch
              ? inlineMatch[1]
              : null}
        </span>
      )}

      {/* Level badge */}
      <span
        className={`w-12 shrink-0 text-right font-semibold select-none ${levelColorClass(level)}`}
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

      <span
        className={`min-w-0 flex-1 ${textColor} ${isStackTrace ? "pl-4 text-xs" : ""}`}
      >
        <HighlightedText text={bodyText} query={search} />
      </span>
    </div>
  )
})
