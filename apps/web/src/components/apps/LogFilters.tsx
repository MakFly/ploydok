// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import {
  RiCloseLine,
  RiDownloadLine,
  RiPauseLine,
  RiPlayLine,
  RiSearchLine,
} from "@remixicon/react"
import { cn } from "@workspace/ui/lib/utils"
import type { LogLevel } from "../../lib/hooks/use-log-stream"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VolumeOption = 100 | 500 | 1000 | 5000

export const VOLUME_OPTIONS: ReadonlyArray<VolumeOption> = [100, 500, 1000, 5000]

export interface LogFiltersState {
  volume: VolumeOption
  level: LogLevel
  search: string
  paused: boolean
}

export interface LogFiltersProps {
  state: LogFiltersState
  onChange: (next: Partial<LogFiltersState>) => void
  /** Called when the user clicks Download. */
  onDownload: () => void
  /** Number of buffered lines (shown when paused) */
  bufferedCount?: number
  className?: string
}

// ---------------------------------------------------------------------------
// Helpers — exported for tests
// ---------------------------------------------------------------------------

/**
 * Formats a volume option for display.
 */
export function formatVolume(v: VolumeOption): string {
  return v >= 1000 ? `${v / 1000}k` : String(v)
}

// ---------------------------------------------------------------------------
// Dark-mode select — reusable styled native select
// ---------------------------------------------------------------------------

function DarkSelect({
  id,
  value,
  onChange,
  "aria-label": ariaLabel,
  children,
}: {
  id: string
  value: string | number
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
  "aria-label": string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <select
      id={id}
      value={value}
      onChange={onChange}
      aria-label={ariaLabel}
      className="h-7 rounded border border-zinc-700 bg-zinc-800 px-2 text-[11px] text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-500 cursor-pointer"
    >
      {children}
    </select>
  )
}

// ---------------------------------------------------------------------------
// LogFilters
// ---------------------------------------------------------------------------

export function LogFilters({
  state,
  onChange,
  onDownload,
  bufferedCount = 0,
  className,
}: LogFiltersProps): React.JSX.Element {
  // Debounced search input — local draft flushed after 200 ms of inactivity
  const [searchDraft, setSearchDraft] = React.useState(state.search)
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep draft in sync when parent resets externally
  React.useEffect(() => {
    setSearchDraft(state.search)
  }, [state.search])

  const handleSearchChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value
      setSearchDraft(value)
      if (debounceRef.current !== null) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        onChange({ search: value })
      }, 200)
    },
    [onChange],
  )

  const handleClearSearch = React.useCallback(() => {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current)
    setSearchDraft("")
    onChange({ search: "" })
  }, [onChange])

  // Cleanup on unmount
  React.useEffect(
    () => () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current)
    },
    [],
  )

  const handleVolumeChange = React.useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onChange({ volume: Number(e.target.value) as VolumeOption })
    },
    [onChange],
  )

  const handleLevelChange = React.useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onChange({ level: e.target.value as LogLevel })
    },
    [onChange],
  )

  const handleTogglePause = React.useCallback(() => {
    onChange({ paused: !state.paused })
  }, [onChange, state.paused])

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 bg-zinc-900/95 backdrop-blur border-b border-zinc-800 px-4 py-2",
        className,
      )}
      role="toolbar"
      aria-label="Log filters"
    >
      {/* Volume select */}
      <div className="flex items-center gap-1.5 shrink-0">
        <label
          htmlFor="log-volume"
          className="text-[11px] text-zinc-400 select-none"
        >
          Lines
        </label>
        <DarkSelect
          id="log-volume"
          value={state.volume}
          onChange={handleVolumeChange}
          aria-label="Maximum lines to display"
        >
          {VOLUME_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {formatVolume(v)}
            </option>
          ))}
        </DarkSelect>
      </div>

      {/* Level select */}
      <div className="flex items-center gap-1.5 shrink-0">
        <label
          htmlFor="log-level"
          className="text-[11px] text-zinc-400 select-none"
        >
          Level
        </label>
        <DarkSelect
          id="log-level"
          value={state.level}
          onChange={handleLevelChange}
          aria-label="Log level filter"
        >
          <option value="all">All</option>
          <option value="info">Info</option>
          <option value="warn">Warn</option>
          <option value="error">Error</option>
        </DarkSelect>
      </div>

      {/* Search with icon + clear button */}
      <div className="relative flex items-center shrink-0">
        <RiSearchLine
          className="pointer-events-none absolute left-2 size-3.5 text-zinc-500"
          aria-hidden="true"
        />
        <input
          type="search"
          value={searchDraft}
          onChange={handleSearchChange}
          placeholder="Search…"
          className="h-7 w-48 rounded border border-zinc-700 bg-zinc-800 pl-6 pr-6 text-[11px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
          aria-label="Search log lines"
        />
        {searchDraft && (
          <button
            type="button"
            onClick={handleClearSearch}
            aria-label="Clear search"
            className="absolute right-1.5 flex items-center justify-center rounded p-0.5 text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <RiCloseLine className="size-3" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Buffered count badge (visible when paused and buffer > 0) */}
      {state.paused && bufferedCount > 0 && (
        <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
          +{bufferedCount.toLocaleString()} buffered
        </span>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Pause / Resume */}
        <button
          type="button"
          onClick={handleTogglePause}
          title={state.paused ? "Resume — flush buffered lines" : "Pause display"}
          aria-pressed={state.paused}
          className={cn(
            "inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium transition-colors",
            state.paused
              ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
              : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700/60",
          )}
        >
          {state.paused ? (
            <>
              <RiPlayLine className="size-3" aria-hidden="true" />
              Resume
            </>
          ) : (
            <>
              <RiPauseLine className="size-3" aria-hidden="true" />
              Pause
            </>
          )}
        </button>

        {/* Download — icon only with tooltip */}
        <button
          type="button"
          onClick={onDownload}
          title="Download logs (.log)"
          aria-label="Download logs"
          className="inline-flex items-center justify-center rounded p-1.5 text-zinc-400 transition-colors hover:text-zinc-100 hover:bg-zinc-700/60"
        >
          <RiDownloadLine className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// useLogFilters — convenience hook that owns the filter state
// ---------------------------------------------------------------------------

export function useLogFilters(
  defaults?: Partial<LogFiltersState>,
): [LogFiltersState, (next: Partial<LogFiltersState>) => void] {
  const [state, setState] = React.useState<LogFiltersState>({
    volume: 100,
    level: "all",
    search: "",
    paused: false,
    ...defaults,
  })

  const onChange = React.useCallback((next: Partial<LogFiltersState>) => {
    setState((prev) => ({ ...prev, ...next }))
  }, [])

  return [state, onChange]
}
