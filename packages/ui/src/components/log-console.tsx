// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import {
  RiSearchLine,
  RiTimeLine,
  RiCornerDownRightLine,
  RiPauseLine,
  RiPlayLine,
  RiDeleteBinLine,
  RiDownloadLine,
} from "@remixicon/react"
import { cn } from "@workspace/ui/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LogLine {
  id: number
  text: string
  t?: number
  stream?: "stdout" | "stderr"
}

export interface LogConsoleProps {
  lines: Array<LogLine>
  connected: boolean
  error?: string | null
  title?: string
  className?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ERROR_RE = /(^|\s)(error|fatal|err:|panic)\b/i
const WARN_RE = /(^|\s)(warn|warning)\b/i

function lineColorClass(text: string): string {
  if (ERROR_RE.test(text)) return "text-red-400"
  if (WARN_RE.test(text)) return "text-amber-400"
  return "text-[#e5e7eb]"
}

function formatTimestamp(t: number): string {
  const d = new Date(t)
  const hh = d.getHours().toString().padStart(2, "0")
  const mm = d.getMinutes().toString().padStart(2, "0")
  const ss = d.getSeconds().toString().padStart(2, "0")
  const ms = d.getMilliseconds().toString().padStart(3, "0")
  return `${hh}:${mm}:${ss}.${ms}`
}

// ---------------------------------------------------------------------------
// ToolbarButton
// ---------------------------------------------------------------------------

interface ToolbarButtonProps {
  onClick: () => void
  active?: boolean
  title: string
  children: React.ReactNode
}

function ToolbarButton({
  onClick,
  active,
  title,
  children,
}: ToolbarButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[11px] transition-colors",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
      )}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// LogConsole
// ---------------------------------------------------------------------------

export function LogConsole({
  lines,
  connected,
  error,
  title,
  className,
}: LogConsoleProps): React.JSX.Element {
  const [search, setSearch] = React.useState("")
  const [showTimestamps, setShowTimestamps] = React.useState(false)
  const [wordWrap, setWordWrap] = React.useState(true)
  const [paused, setPaused] = React.useState(false)
  // Displayed lines — frozen while paused, flushed on resume
  const [displayLines, setDisplayLines] = React.useState<Array<LogLine>>(lines)
  const pendingRef = React.useRef<Array<LogLine>>([])
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const followRef = React.useRef(true)

  // Track incoming lines; if paused, buffer them
  React.useEffect(() => {
    if (paused) {
      // Accumulate new lines that arrived since last render
      pendingRef.current = lines
    } else {
      setDisplayLines(lines)
      pendingRef.current = []
    }
  }, [lines, paused])

  // When user resumes, flush buffered lines
  const handleResume = React.useCallback(() => {
    setDisplayLines(pendingRef.current.length > 0 ? pendingRef.current : lines)
    pendingRef.current = []
    setPaused(false)
  }, [lines])

  const handlePause = React.useCallback(() => {
    setPaused(true)
  }, [])

  // Auto-scroll
  React.useEffect(() => {
    if (!followRef.current) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [displayLines])

  const handleScroll = React.useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32
    followRef.current = atBottom
  }, [])

  // Filter
  const normalizedSearch = search.trim().toLowerCase()
  const filtered = normalizedSearch
    ? displayLines.filter((l) =>
        l.text.toLowerCase().includes(normalizedSearch),
      )
    : displayLines

  // Clear display
  const handleClear = React.useCallback(() => {
    setDisplayLines([])
    pendingRef.current = []
  }, [])

  // Download
  const handleDownload = React.useCallback(() => {
    const content = filtered.map((l) => l.text).join("\n")
    const blob = new Blob([content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = title ? `${title}.txt` : "logs.txt"
    a.click()
    URL.revokeObjectURL(url)
  }, [filtered, title])

  const pendingCount = pendingRef.current.length

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border border-border bg-[#0d0d0d] font-mono text-xs overflow-hidden",
        className,
      )}
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 bg-muted/40 px-3 py-1.5">
        {/* Status */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={cn(
              "size-2 rounded-full",
              connected ? "bg-green-500" : "bg-muted-foreground/40",
            )}
            aria-hidden="true"
          />
          <span className="text-muted-foreground text-[11px]">
            {connected ? "Live" : "Disconnected"}
          </span>
        </div>

        {title && (
          <span className="text-muted-foreground/60 text-[11px] shrink-0">
            {title}
          </span>
        )}

        {/* Paused badge */}
        {paused && (
          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-400 shrink-0">
            PAUSED
            {pendingCount > 0
              ? ` +${pendingCount.toLocaleString()}`
              : ""}
          </span>
        )}

        {/* Search */}
        <div className="relative flex items-center ml-1">
          <RiSearchLine
            className="pointer-events-none absolute left-1.5 size-3 text-muted-foreground/60"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter\u2026"
            className="h-5 w-32 rounded border border-border/60 bg-background/60 pl-5 pr-2 text-[11px] placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring/50"
            aria-label="Filter log lines"
          />
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Line count */}
        {displayLines.length > 0 && (
          <span className="text-muted-foreground/60 text-[11px] shrink-0">
            {(normalizedSearch ? filtered.length : displayLines.length).toLocaleString()} lines
          </span>
        )}

        {/* Toggle buttons */}
        <div className="flex items-center gap-0.5">
          <ToolbarButton
            onClick={() => setShowTimestamps((v) => !v)}
            active={showTimestamps}
            title={showTimestamps ? "Hide timestamps" : "Show timestamps"}
          >
            <RiTimeLine className="size-3" aria-hidden="true" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => setWordWrap((v) => !v)}
            active={wordWrap}
            title={wordWrap ? "Disable word wrap" : "Enable word wrap"}
          >
            <RiCornerDownRightLine className="size-3" aria-hidden="true" />
          </ToolbarButton>

          {paused ? (
            <ToolbarButton
              onClick={handleResume}
              title="Resume — flush buffered lines"
            >
              <RiPlayLine className="size-3" aria-hidden="true" />
            </ToolbarButton>
          ) : (
            <ToolbarButton onClick={handlePause} title="Pause display">
              <RiPauseLine className="size-3" aria-hidden="true" />
            </ToolbarButton>
          )}

          <ToolbarButton onClick={handleClear} title="Clear display">
            <RiDeleteBinLine className="size-3" aria-hidden="true" />
          </ToolbarButton>

          <ToolbarButton onClick={handleDownload} title="Download as .txt">
            <RiDownloadLine className="size-3" aria-hidden="true" />
          </ToolbarButton>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-3 py-1.5 text-xs text-destructive bg-destructive/10 border-b border-destructive/20">
          {error}
        </div>
      )}

      {/* Log body */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto p-3 min-h-[200px] max-h-[600px]"
        role="log"
        aria-live="polite"
        aria-label={title ? `${title} logs` : "Logs"}
      >
        {filtered.length === 0 ? (
          <span className="text-muted-foreground/60">
            {normalizedSearch
              ? "No lines match your filter."
              : "Waiting for logs\u2026"}
          </span>
        ) : (
          filtered.map((line) => (
            <div
              key={line.id}
              className={cn(
                "leading-relaxed",
                lineColorClass(line.text),
                wordWrap
                  ? "whitespace-pre-wrap break-all"
                  : "whitespace-pre overflow-x-auto",
              )}
            >
              {showTimestamps && line.t !== undefined && (
                <span className="mr-2 text-muted-foreground/60 select-none">
                  {formatTimestamp(line.t)}
                </span>
              )}
              {line.text}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
