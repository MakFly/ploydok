// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import {
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiFileLine,
  RiFolderFill,
  RiFolderOpenFill,
  RiLink,
  RiLoader4Line,
  RiRefreshLine,
} from "@remixicon/react"
import {  listContainerFiles } from "../../lib/container-files"
import { FileViewer } from "./FileViewer"
import type {FileEntry} from "../../lib/container-files";

interface FileBrowserProps {
  appId: string
}

interface DirState {
  entries: Array<FileEntry> | null
  loading: boolean
  error: string | null
  expanded: boolean
}

type DirMap = Map<string, DirState>

const ROOT_PATH = "/"

function makeInitial(): DirMap {
  const m: DirMap = new Map()
  m.set(ROOT_PATH, {
    entries: null,
    loading: true,
    error: null,
    expanded: true,
  })
  return m
}

export function FileBrowser({ appId }: FileBrowserProps): React.JSX.Element {
  const [dirs, setDirs] = React.useState<DirMap>(makeInitial)
  const [selected, setSelected] = React.useState<string | null>(null)

  const fetchDir = React.useCallback(
    async (path: string) => {
      setDirs((prev) => {
        const next = new Map(prev)
        const cur = next.get(path) ?? {
          entries: null,
          loading: false,
          error: null,
          expanded: true,
        }
        next.set(path, { ...cur, loading: true, error: null })
        return next
      })

      try {
        const res = await listContainerFiles(appId, path)
        setDirs((prev) => {
          const next = new Map(prev)
          const cur = next.get(path) ?? {
            entries: null,
            loading: false,
            error: null,
            expanded: true,
          }
          next.set(path, {
            ...cur,
            entries: res.entries,
            loading: false,
            error: null,
          })
          return next
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : "Listing failed"
        setDirs((prev) => {
          const next = new Map(prev)
          const cur = next.get(path) ?? {
            entries: null,
            loading: false,
            error: null,
            expanded: true,
          }
          next.set(path, { ...cur, loading: false, error: message })
          return next
        })
      }
    },
    [appId]
  )

  React.useEffect(() => {
    void fetchDir(ROOT_PATH)
  }, [fetchDir])

  const toggleDir = React.useCallback(
    (path: string) => {
      let needsFetch = false
      setDirs((prev) => {
        const next = new Map(prev)
        const cur = next.get(path)
        if (!cur) {
          needsFetch = true
          next.set(path, {
            entries: null,
            loading: false,
            error: null,
            expanded: true,
          })
          return next
        }
        const willExpand = !cur.expanded
        if (willExpand && !cur.entries && !cur.loading) needsFetch = true
        next.set(path, { ...cur, expanded: willExpand })
        return next
      })
      if (needsFetch) void fetchDir(path)
    },
    [fetchDir]
  )

  const refresh = React.useCallback(() => {
    setDirs(makeInitial())
    void fetchDir(ROOT_PATH)
  }, [fetchDir])

  return (
    <>
      <aside className="flex h-full w-[300px] shrink-0 flex-col border-l border-border bg-card/40">
        <header className="flex h-9 items-center justify-between border-b border-border px-3">
          <div className="flex items-center gap-2">
            <RiFolderFill size={14} className="text-amber-400/80" />
            <span className="text-xs font-medium tracking-wide text-foreground">
              Files
            </span>
          </div>
          <button
            type="button"
            onClick={refresh}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Refresh file tree"
            title="Refresh"
          >
            <RiRefreshLine size={13} />
          </button>
        </header>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-auto py-1.5">
          <DirNode
            path={ROOT_PATH}
            name="/"
            depth={0}
            dirs={dirs}
            onToggle={toggleDir}
            onSelectFile={setSelected}
            selected={selected}
          />
        </div>
      </aside>

      <FileViewer
        appId={appId}
        path={selected}
        onClose={() => setSelected(null)}
      />
    </>
  )
}

interface DirNodeProps {
  path: string
  name: string
  depth: number
  dirs: DirMap
  onToggle: (path: string) => void
  onSelectFile: (path: string) => void
  selected: string | null
}

function DirNode({
  path,
  name,
  depth,
  dirs,
  onToggle,
  onSelectFile,
  selected,
}: DirNodeProps): React.JSX.Element {
  const state = dirs.get(path)
  const expanded = state?.expanded ?? false

  return (
    <div>
      <Row
        depth={depth}
        active={false}
        onClick={() => onToggle(path)}
        title={path}
      >
        {expanded ? (
          <RiArrowDownSLine
            size={13}
            className="shrink-0 text-muted-foreground/70"
          />
        ) : (
          <RiArrowRightSLine
            size={13}
            className="shrink-0 text-muted-foreground/70"
          />
        )}
        {expanded ? (
          <RiFolderOpenFill size={13} className="shrink-0 text-amber-400/90" />
        ) : (
          <RiFolderFill size={13} className="shrink-0 text-amber-400/80" />
        )}
        <span className="truncate text-foreground/90">{name}</span>
      </Row>

      {expanded && (
        <DirChildren
          path={path}
          depth={depth}
          dirs={dirs}
          onToggle={onToggle}
          onSelectFile={onSelectFile}
          selected={selected}
        />
      )}
    </div>
  )
}

interface DirChildrenProps {
  path: string
  depth: number
  dirs: DirMap
  onToggle: (path: string) => void
  onSelectFile: (path: string) => void
  selected: string | null
}

function DirChildren({
  path,
  depth,
  dirs,
  onToggle,
  onSelectFile,
  selected,
}: DirChildrenProps): React.JSX.Element {
  const state = dirs.get(path)

  if (!state) return <></>
  if (state.loading) {
    return (
      <Row depth={depth + 1} muted>
        <RiLoader4Line
          size={12}
          className="shrink-0 animate-spin text-muted-foreground"
        />
        <span className="text-muted-foreground italic">Loading…</span>
      </Row>
    )
  }
  if (state.error) {
    return (
      <Row depth={depth + 1} muted title={state.error}>
        <span className="truncate text-red-400/90">{state.error}</span>
      </Row>
    )
  }
  if (!state.entries || state.entries.length === 0) {
    return (
      <Row depth={depth + 1} muted>
        <span className="text-muted-foreground/70 italic">empty</span>
      </Row>
    )
  }

  return (
    <div>
      {state.entries.map((entry) => {
        if (entry.is_dir) {
          return (
            <DirNode
              key={entry.path}
              path={entry.path}
              name={entry.name}
              depth={depth + 1}
              dirs={dirs}
              onToggle={onToggle}
              onSelectFile={onSelectFile}
              selected={selected}
            />
          )
        }
        const isSelected = selected === entry.path
        return (
          <Row
            key={entry.path}
            depth={depth + 1}
            active={isSelected}
            onClick={() => onSelectFile(entry.path)}
            title={entry.path}
            indented
          >
            {entry.is_symlink ? (
              <RiLink size={13} className="shrink-0 text-blue-400/80" />
            ) : (
              <RiFileLine
                size={13}
                className="shrink-0 text-muted-foreground/70"
              />
            )}
            <span className="truncate text-foreground/85">{entry.name}</span>
          </Row>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Row — single tree row with consistent indentation, hover + active states.
// ---------------------------------------------------------------------------

interface RowProps {
  depth: number
  children: React.ReactNode
  onClick?: () => void
  active?: boolean
  muted?: boolean
  indented?: boolean
  title?: string
}

function Row({
  depth,
  children,
  onClick,
  active = false,
  muted = false,
  indented = false,
  title,
}: RowProps): React.JSX.Element {
  // Visually align file rows under the disclosure arrow of their parent.
  const offset = indented ? 13 : 0
  const padLeft = `${depth * 12 + 8 + offset}px`

  const className = [
    "group flex w-full items-center gap-1.5 px-2 py-[3px] text-left font-mono text-[11.5px] leading-tight",
    onClick ? "cursor-pointer transition-colors" : "cursor-default",
    active
      ? "bg-primary/15 text-foreground"
      : onClick
        ? "hover:bg-muted/60"
        : "",
    muted ? "select-none" : "",
  ]
    .filter(Boolean)
    .join(" ")

  if (!onClick) {
    return (
      <div className={className} style={{ paddingLeft: padLeft }} title={title}>
        {children}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={className}
      style={{ paddingLeft: padLeft }}
      title={title}
    >
      {children}
    </button>
  )
}
