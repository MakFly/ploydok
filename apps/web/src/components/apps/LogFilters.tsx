// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useTranslation } from "react-i18next"
import {
  RiArrowDownLine,
  RiArrowUpLine,
  RiCheckLine,
  RiCloseLine,
  RiDownloadLine,
  RiErrorWarningLine,
  RiFileCopyLine,
  RiPauseLine,
  RiPlayLine,
  RiSearchLine,
  RiTextWrap,
  RiTimeLine,
} from "@remixicon/react"
import { cn } from "@workspace/ui/lib/utils"
import type { LogLevel } from "../../lib/hooks/use-log-stream"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VolumeOption = 100 | 500 | 1000 | 5000

export const VOLUME_OPTIONS: ReadonlyArray<VolumeOption> = [
  100, 500, 1000, 5000,
]

export interface LogFiltersState {
  volume: VolumeOption
  level: LogLevel
  search: string
  paused: boolean
  /** Word-wrap long log lines (default true) */
  wrap: boolean
  /** Show timestamp column (default true) */
  timestamps: boolean
}

export interface LogFiltersProps {
  state: LogFiltersState
  onChange: (next: Partial<LogFiltersState>) => void
  /** Called when the user clicks Download (raw .log). */
  onDownload: () => void
  /** Called when the user clicks Copy — copies filtered lines to clipboard. */
  onCopy?: () => void
  /** Called when the user wants to jump to next/previous error line. */
  onJumpError?: (direction: "next" | "prev") => void
  /** Number of buffered lines (shown when paused) */
  bufferedCount?: number
  /** Total error / warn line counts in the current view (filtered). */
  errorCount?: number
  warnCount?: number
  className?: string
  /** Imperative ref to focus the search input (e.g. via "/" shortcut). */
  searchInputRef?: React.RefObject<HTMLInputElement | null>
}

// ---------------------------------------------------------------------------
// Helpers — exported for tests
// ---------------------------------------------------------------------------

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
      className="h-7 cursor-pointer rounded border border-white/15 bg-white/10 px-2 text-xs text-[#e5e7eb] focus:ring-1 focus:ring-white/30 focus:outline-none"
    >
      {children}
    </select>
  )
}

// ---------------------------------------------------------------------------
// IconToggle — square icon button with active state
// ---------------------------------------------------------------------------

function IconToggle({
  active,
  onClick,
  title,
  ariaLabel,
  children,
}: {
  active?: boolean
  onClick: () => void
  title: string
  ariaLabel: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded transition-colors",
        active
          ? "bg-white/15 text-[#e5e7eb]"
          : "text-white/55 hover:bg-white/10 hover:text-[#e5e7eb]"
      )}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// CountChip — clickable error/warn count, applies level filter
// ---------------------------------------------------------------------------

function CountChip({
  count,
  level,
  active,
  onClick,
}: {
  count: number
  level: "error" | "warn"
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  const { t } = useTranslation("apps")
  if (count === 0) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium",
          "bg-white/5 text-white/40"
        )}
        title={level === "error" ? t("logs.noErrors") : t("logs.noWarns")}
      >
        {level === "error" ? "0E" : "0W"}
      </span>
    )
  }
  const palette =
    level === "error"
      ? active
        ? "bg-red-500/30 text-red-200 ring-1 ring-red-400/50"
        : "bg-red-500/15 text-red-300 hover:bg-red-500/25"
      : active
        ? "bg-amber-500/30 text-amber-200 ring-1 ring-amber-400/50"
        : "bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
  return (
    <button
      type="button"
      onClick={onClick}
      title={
        active
          ? level === "error"
            ? t("logs.clearErrorFilter")
            : t("logs.clearWarnFilter")
          : level === "error"
            ? t("logs.showOnlyErrors", { count })
            : t("logs.showOnlyWarnings", { count })
      }
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums transition-colors",
        palette
      )}
    >
      <RiErrorWarningLine className="size-3" aria-hidden="true" />
      {count.toLocaleString()}
    </button>
  )
}

// ---------------------------------------------------------------------------
// LogFilters
// ---------------------------------------------------------------------------

export function LogFilters({
  state,
  onChange,
  onDownload,
  onCopy,
  onJumpError,
  bufferedCount = 0,
  errorCount = 0,
  warnCount = 0,
  className,
  searchInputRef,
}: LogFiltersProps): React.JSX.Element {
  const { t } = useTranslation(["apps", "common"])
  const [searchDraft, setSearchDraft] = React.useState(state.search)
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const [copied, setCopied] = React.useState(false)

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
    [onChange]
  )

  const handleClearSearch = React.useCallback(() => {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current)
    setSearchDraft("")
    onChange({ search: "" })
  }, [onChange])

  React.useEffect(
    () => () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current)
    },
    []
  )

  const handleVolumeChange = React.useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onChange({ volume: Number(e.target.value) as VolumeOption })
    },
    [onChange]
  )

  const handleLevelChange = React.useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onChange({ level: e.target.value as LogLevel })
    },
    [onChange]
  )

  const handleTogglePause = React.useCallback(() => {
    onChange({ paused: !state.paused })
  }, [onChange, state.paused])

  const handleToggleLevel = React.useCallback(
    (target: "error" | "warn") => {
      onChange({ level: state.level === target ? "all" : target })
    },
    [onChange, state.level]
  )

  const handleCopy = React.useCallback(() => {
    if (!onCopy) return
    onCopy()
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }, [onCopy])

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 border-b border-white/10 bg-white/5 px-4 py-2 backdrop-blur",
        className
      )}
      role="toolbar"
      aria-label={t("logs.filters")}
    >
      {/* Volume select */}
      <div className="flex shrink-0 items-center gap-1.5">
        <label
          htmlFor="log-volume"
          className="text-xs text-white/55 select-none"
        >
          {t("logs.lines")}
        </label>
        <DarkSelect
          id="log-volume"
          value={state.volume}
          onChange={handleVolumeChange}
          aria-label={t("logs.maxLines")}
        >
          {VOLUME_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {formatVolume(v)}
            </option>
          ))}
        </DarkSelect>
      </div>

      {/* Level select */}
      <div className="flex shrink-0 items-center gap-1.5">
        <label
          htmlFor="log-level"
          className="text-xs text-white/55 select-none"
        >
          {t("logs.level")}
        </label>
        <DarkSelect
          id="log-level"
          value={state.level}
          onChange={handleLevelChange}
          aria-label={t("logs.levelFilter")}
        >
          <option value="all">{t("logs.all")}</option>
          <option value="debug">{t("logs.debug")}</option>
          <option value="info">{t("logs.info")}</option>
          <option value="warn">{t("logs.warn")}</option>
          <option value="error">{t("logs.error")}</option>
        </DarkSelect>
      </div>

      {/* Search with icon + clear button */}
      <div className="relative flex shrink-0 items-center">
        <RiSearchLine
          className="pointer-events-none absolute left-2 size-3.5 text-white/45"
          aria-hidden="true"
        />
        <input
          ref={searchInputRef ?? undefined}
          type="search"
          value={searchDraft}
          onChange={handleSearchChange}
          placeholder={t("logs.searchPlaceholder")}
          className="h-7 w-56 rounded border border-white/15 bg-white/10 pr-6 pl-6 text-xs text-[#e5e7eb] placeholder:text-white/40 focus:ring-1 focus:ring-white/30 focus:outline-none"
          aria-label={t("logs.search")}
        />
        {searchDraft && (
          <button
            type="button"
            onClick={handleClearSearch}
            aria-label={t("logs.clearSearch")}
            className="absolute right-1.5 flex items-center justify-center rounded p-0.5 text-white/45 transition-colors hover:text-[#e5e7eb]"
          >
            <RiCloseLine className="size-3" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Counters — clickable to filter level */}
      <div className="flex shrink-0 items-center gap-1">
        <CountChip
          count={errorCount}
          level="error"
          active={state.level === "error"}
          onClick={() => handleToggleLevel("error")}
        />
        <CountChip
          count={warnCount}
          level="warn"
          active={state.level === "warn"}
          onClick={() => handleToggleLevel("warn")}
        />
      </div>

      {/* Jump to error nav */}
      {onJumpError && errorCount > 0 && (
        <div className="flex shrink-0 items-center gap-0.5 rounded border border-white/15 bg-white/5">
          <button
            type="button"
            onClick={() => onJumpError("prev")}
            title={t("logs.prevErrorTitle")}
            aria-label={t("logs.prevError")}
            className="inline-flex h-7 w-6 items-center justify-center text-white/55 hover:bg-white/10 hover:text-[#e5e7eb]"
          >
            <RiArrowUpLine className="size-3.5" aria-hidden="true" />
          </button>
          <span className="px-1 text-xs text-white/45 select-none">err</span>
          <button
            type="button"
            onClick={() => onJumpError("next")}
            title={t("logs.nextErrorTitle")}
            aria-label={t("logs.nextError")}
            className="inline-flex h-7 w-6 items-center justify-center text-white/55 hover:bg-white/10 hover:text-[#e5e7eb]"
          >
            <RiArrowDownLine className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Buffered count badge (visible when paused and buffer > 0) */}
      {state.paused && bufferedCount > 0 && (
        <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[11px] font-medium text-amber-400">
          {t("logs.buffered", { count: bufferedCount.toLocaleString() })}
        </span>
      )}

      {/* Display toggles */}
      <div className="flex shrink-0 items-center gap-0.5 border-l border-white/10 pl-2">
        <IconToggle
          active={state.wrap}
          onClick={() => onChange({ wrap: !state.wrap })}
          title={t("logs.wrapTitle")}
          ariaLabel={t("logs.wrap")}
        >
          <RiTextWrap className="size-3.5" aria-hidden="true" />
        </IconToggle>
        <IconToggle
          active={state.timestamps}
          onClick={() => onChange({ timestamps: !state.timestamps })}
          title={t("logs.timestampsTitle")}
          ariaLabel={t("logs.timestamps")}
        >
          <RiTimeLine className="size-3.5" aria-hidden="true" />
        </IconToggle>
      </div>

      {/* Action buttons */}
      <div className="flex shrink-0 items-center gap-0.5 border-l border-white/10 pl-2">
        <button
          type="button"
          onClick={handleTogglePause}
          title={
            state.paused
              ? t("logs.resumeFlush")
              : t("logs.pauseDisplay")
          }
          aria-pressed={state.paused}
          className={cn(
            "inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors",
            state.paused
              ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
              : "text-white/55 hover:bg-white/10 hover:text-[#e5e7eb]"
          )}
        >
          {state.paused ? (
            <>
              <RiPlayLine className="size-3" aria-hidden="true" />
              {t("logs.resume")}
            </>
          ) : (
            <>
              <RiPauseLine className="size-3" aria-hidden="true" />
              {t("logs.pause")}
            </>
          )}
        </button>

        {onCopy && (
          <IconToggle
            active={false}
            onClick={handleCopy}
            title={t("logs.copyVisible")}
            ariaLabel={t("logs.copyLogs")}
          >
            {copied ? (
              <RiCheckLine
                className="size-3.5 text-emerald-400"
                aria-hidden="true"
              />
            ) : (
              <RiFileCopyLine className="size-3.5" aria-hidden="true" />
            )}
          </IconToggle>
        )}

        <IconToggle
          active={false}
          onClick={onDownload}
          title={t("logs.download")}
          ariaLabel={t("logs.downloadLogs")}
        >
          <RiDownloadLine className="size-3.5" aria-hidden="true" />
        </IconToggle>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// useLogFilters — convenience hook that owns the filter state
// ---------------------------------------------------------------------------

const PREFS_KEY = "ploydok:logs:prefs"

interface PersistedPrefs {
  wrap?: boolean
  timestamps?: boolean
  volume?: VolumeOption
}

function loadPrefs(): PersistedPrefs {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(PREFS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as PersistedPrefs
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function savePrefs(prefs: PersistedPrefs): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    /* storage unavailable */
  }
}

export function useLogFilters(
  defaults?: Partial<LogFiltersState>
): [LogFiltersState, (next: Partial<LogFiltersState>) => void] {
  const [state, setState] = React.useState<LogFiltersState>(() => {
    const persisted = loadPrefs()
    return {
      volume: persisted.volume ?? 100,
      level: "all",
      search: "",
      paused: false,
      wrap: persisted.wrap ?? true,
      timestamps: persisted.timestamps ?? true,
      ...defaults,
    }
  })

  const onChange = React.useCallback((next: Partial<LogFiltersState>) => {
    setState((prev) => {
      const merged = { ...prev, ...next }
      // Persist UI prefs only — search/level/paused are session-scoped
      if ("wrap" in next || "timestamps" in next || "volume" in next) {
        savePrefs({
          wrap: merged.wrap,
          timestamps: merged.timestamps,
          volume: merged.volume,
        })
      }
      return merged
    })
  }, [])

  return [state, onChange]
}
