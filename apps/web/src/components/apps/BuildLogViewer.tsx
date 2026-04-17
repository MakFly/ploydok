// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { RiArrowDownLine } from "@remixicon/react"
import { cn } from "@workspace/ui/lib/utils"
import {
  filterByLevel,
  filterBySearch,
  useLogStream,
} from "../../lib/hooks/use-log-stream"
import { LogFilters, useLogFilters } from "./LogFilters"
import { LogLine } from "./LogLine"
import type { LogLine as LogLineData } from "../../lib/hooks/use-log-stream"
import type { LogFiltersState } from "./LogFilters"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BuildLogViewerProps {
  /** App ID */
  appId: string
  /** Build ID — if undefined or "latest", streams runtime logs */
  buildId?: string
  /** Optional app name for the download filename and title bar */
  appName?: string
  className?: string
}

// ---------------------------------------------------------------------------
// TitleBar
// ---------------------------------------------------------------------------

function TitleBar({
  title,
  isLive,
  lineCount,
}: {
  title: string
  isLive: boolean
  lineCount: number
}): React.JSX.Element {
  return (
    <div className="flex h-8 items-center gap-2 border-b border-zinc-800 bg-zinc-900 px-4 shrink-0">
      <span
        className={cn(
          "size-2 rounded-full shrink-0",
          isLive ? "bg-green-500" : "bg-zinc-600",
        )}
        aria-hidden="true"
      />
      <span className="text-[11px] font-medium text-zinc-300 truncate">
        {title}
      </span>
      <span className="text-[11px] text-zinc-600 shrink-0">
        {isLive ? "Live" : "Disconnected"}
      </span>
      <div className="flex-1" />
      {lineCount > 0 && (
        <span className="text-[11px] text-zinc-600 shrink-0 tabular-nums">
          {lineCount.toLocaleString()} lines
        </span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// FollowButton — floating pill shown when user has scrolled away from bottom
// ---------------------------------------------------------------------------

function FollowButton({
  visible,
  newCount,
  onClick,
}: {
  visible: boolean
  newCount: number
  onClick: () => void
}): React.JSX.Element | null {
  if (!visible) return null
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute bottom-4 right-4 flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors"
    >
      <RiArrowDownLine className="size-3.5" aria-hidden="true" />
      Follow latest
      {newCount > 0 && (
        <span className="rounded-full bg-primary-foreground/20 px-1.5 py-0.5 text-[10px]">
          {newCount}
        </span>
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// BuildLogViewer — integrates title bar + filters + auto-scroll + MutationObserver
// ---------------------------------------------------------------------------

export function BuildLogViewer({
  appId,
  buildId,
  appName,
  className,
}: BuildLogViewerProps): React.JSX.Element {
  const [filters, setFilters] = useLogFilters()

  const { lines, connected, error } = useLogStream({
    appId,
    buildId,
    maxLines: filters.volume,
  })

  // ---------------------------------------------------------------------------
  // Pause / resume buffer
  // ---------------------------------------------------------------------------
  const [displayLines, setDisplayLines] = React.useState<Array<LogLineData>>(lines)
  const pauseBufferRef = React.useRef<Array<LogLineData>>([])

  React.useEffect(() => {
    if (filters.paused) {
      const incoming = lines.slice(displayLines.length)
      const merged = [...pauseBufferRef.current, ...incoming]
      pauseBufferRef.current =
        merged.length > 1000 ? merged.slice(merged.length - 1000) : merged
    } else {
      setDisplayLines(lines)
      pauseBufferRef.current = []
    }
  }, [lines, filters.paused, displayLines.length])

  const handleFiltersChange = React.useCallback(
    (next: Partial<LogFiltersState>) => {
      if ("paused" in next && next.paused === false) {
        setDisplayLines(lines)
        pauseBufferRef.current = []
      }
      setFilters(next)
    },
    [lines, setFilters],
  )

  // ---------------------------------------------------------------------------
  // Filter pipeline
  // ---------------------------------------------------------------------------
  const levelFiltered = filterByLevel(displayLines, filters.level)
  const filtered = filterBySearch(levelFiltered, filters.search)

  // ---------------------------------------------------------------------------
  // Auto-scroll with MutationObserver
  // ---------------------------------------------------------------------------
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const logBodyRef = React.useRef<HTMLDivElement>(null)
  const followRef = React.useRef(true)
  const [showFollowBtn, setShowFollowBtn] = React.useState(false)
  // Track how many lines were visible when user detached
  const detachLineCountRef = React.useRef(0)

  const scrollToBottom = React.useCallback(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  const handleScroll = React.useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distFromBottom > 50) {
      if (followRef.current) {
        // Just detached — snapshot line count
        detachLineCountRef.current = filtered.length
        followRef.current = false
        setShowFollowBtn(true)
      }
    } else {
      followRef.current = true
      setShowFollowBtn(false)
    }
  }, [filtered.length])

  const handleFollowLatest = React.useCallback(() => {
    followRef.current = true
    setShowFollowBtn(false)
    scrollToBottom()
  }, [scrollToBottom])

  React.useEffect(() => {
    const logBody = logBodyRef.current
    if (!logBody) return
    const observer = new MutationObserver(() => {
      if (followRef.current) {
        scrollToBottom()
      }
    })
    observer.observe(logBody, { childList: true, subtree: false })
    return () => observer.disconnect()
  }, [scrollToBottom])

  // New lines since detachment
  const newLineCount = Math.max(0, filtered.length - detachLineCountRef.current)

  // ---------------------------------------------------------------------------
  // Download
  // ---------------------------------------------------------------------------
  const handleDownload = React.useCallback(() => {
    const content = filtered.map((l) => l.text).join("\n")
    const blob = new Blob([content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    const baseName = appName ?? appId
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
    a.download = `${baseName}-${ts}.log`
    a.click()
    URL.revokeObjectURL(url)
  }, [filtered, appId, appName])

  // ---------------------------------------------------------------------------
  // Title
  // ---------------------------------------------------------------------------
  const title =
    buildId && buildId !== "latest"
      ? `Build ${buildId.slice(0, 8)}${appName ? ` — ${appName}` : ""}`
      : appName
        ? `Runtime logs — ${appName}`
        : "Runtime logs"

  return (
    <div
      className={cn(
        "flex flex-col w-full min-h-0 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950",
        className,
      )}
    >
      {/* Title bar */}
      <TitleBar title={title} isLive={connected} lineCount={filtered.length} />

      {/* Error banner */}
      {error && (
        <div className="px-4 py-1.5 text-xs text-red-400 bg-red-500/10 border-b border-red-500/20 shrink-0">
          {error}
        </div>
      )}

      {/* Filter bar */}
      <LogFilters
        state={filters}
        onChange={handleFiltersChange}
        onDownload={handleDownload}
        bufferedCount={pauseBufferRef.current.length}
      />

      {/* Log body — scrollable, fills remaining space */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full overflow-auto font-mono text-xs"
          role="log"
          aria-live="polite"
          aria-label={`${title} output`}
        >
          {/* Log lines container — observed by MutationObserver */}
          <div ref={logBodyRef} className="py-2">
            {filtered.length === 0 ? (
              <div className="px-4 py-2 text-zinc-500">
                {filters.search || filters.level !== "all"
                  ? "No lines match the current filters."
                  : "Waiting for logs\u2026"}
              </div>
            ) : (
              filtered.map((line) => (
                <LogLine key={line.id} line={line} search={filters.search} />
              ))
            )}
          </div>
        </div>

        {/* Floating "Follow latest" button */}
        <FollowButton
          visible={showFollowBtn}
          newCount={newLineCount}
          onClick={handleFollowLatest}
        />
      </div>
    </div>
  )
}
