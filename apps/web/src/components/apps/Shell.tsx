// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"

// ---------------------------------------------------------------------------
// Shell — xterm.js terminal wired to a WebSocket exec session.
//
// Protocol (locked with API):
//   binary toi→server = stdin bytes
//   binary server→toi = stdout bytes
//   text JSON toi→server = {"type":"resize","cols":N,"rows":N}
//   text JSON server→toi = {"type":"ready"} | {"type":"exit","code":N}
//                         | {"type":"error","message":"..."}
// Close codes: 4001=Unauthorized, 4004=AppNotFound, 1001=Idle, 1011=InternalError
// ---------------------------------------------------------------------------

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3335"

interface ShellProps {
  appId: string
}

function closeReason(code: number): string {
  switch (code) {
    case 4001:
      return "Unauthorized"
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

export function Shell({ appId }: ShellProps): React.JSX.Element {
  const containerRef = React.useRef<HTMLDivElement>(null)
  // Store xterm Terminal instance — typed as unknown to avoid importing at
  // module level (xterm must not run during SSR).
  const termRef = React.useRef<unknown>(null)
  const wsRef = React.useRef<WebSocket | null>(null)
  const fitRef = React.useRef<unknown>(null)
  const resizeObserverRef = React.useRef<ResizeObserver | null>(null)
  const resizeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    // Guard: this must only run in the browser (SSR safety).
    if (typeof window === "undefined") return
    if (!containerRef.current) return

    let disposed = false

    async function init(): Promise<void> {
      const { Terminal } = await import("@xterm/xterm")
      const { FitAddon } = await import("@xterm/addon-fit")
      const { WebLinksAddon } = await import("@xterm/addon-web-links")
      await import("@xterm/xterm/css/xterm.css")

      if (disposed || !containerRef.current) return

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
        theme: {
          background: "#09090b",
          foreground: "#e4e4e7",
          cursor: "#a1a1aa",
          selectionBackground: "#3f3f46",
          black: "#09090b",
          red: "#f87171",
          green: "#4ade80",
          yellow: "#fbbf24",
          blue: "#60a5fa",
          magenta: "#c084fc",
          cyan: "#22d3ee",
          white: "#f4f4f5",
          brightBlack: "#3f3f46",
          brightRed: "#fca5a5",
          brightGreen: "#86efac",
          brightYellow: "#fde68a",
          brightBlue: "#93c5fd",
          brightMagenta: "#d8b4fe",
          brightCyan: "#67e8f9",
          brightWhite: "#fafafa",
        },
        allowTransparency: false,
        scrollback: 3000,
      })

      const fitAddon = new FitAddon()
      term.loadAddon(fitAddon)
      term.loadAddon(new WebLinksAddon())
      term.open(containerRef.current!)
      fitAddon.fit()

      termRef.current = term
      fitRef.current = fitAddon

      // -----------------------------------------------------------------------
      // WebSocket connection
      // -----------------------------------------------------------------------
      const { cols, rows } = term
      const wsBase = API_BASE.replace(/^http/, "ws")
      const url = `${wsBase}/ws/apps/${appId}/exec?cols=${cols}&rows=${rows}`

      term.write("\x1b[2mConnecting to shell\u2026\x1b[0m\r\n")

      const ws = new WebSocket(url)
      ws.binaryType = "arraybuffer"
      wsRef.current = ws

      ws.addEventListener("open", () => {
        if (disposed) {
          ws.close()
          return
        }
        // Clear the "Connecting…" line once ready message arrives.
      })

      ws.addEventListener("message", (evt: MessageEvent) => {
        if (disposed) return
        if (typeof evt.data === "string") {
          // JSON control messages
          try {
            const msg = JSON.parse(evt.data) as {
              type: string
              code?: number
              message?: string
            }
            if (msg.type === "ready") {
              // Clear connecting message and place cursor
              term.reset()
            } else if (msg.type === "exit") {
              term.write(
                `\r\n\x1b[2m[process exited with code ${msg.code ?? 0}]\x1b[0m\r\n`,
              )
            } else if (msg.type === "error") {
              term.write(
                `\r\n\x1b[31m[error: ${msg.message ?? "unknown error"}]\x1b[0m\r\n`,
              )
            }
          } catch {
            // Ignore malformed JSON
          }
        } else {
          // Binary: stdout from the container
          term.write(new Uint8Array(evt.data as ArrayBuffer))
        }
      })

      ws.addEventListener("close", (evt: CloseEvent) => {
        if (disposed) return
        if (evt.code !== 1000) {
          term.write(
            `\r\n\x1b[33m[${closeReason(evt.code)}]\x1b[0m\r\n`,
          )
        }
      })

      ws.addEventListener("error", () => {
        if (disposed) return
        term.write("\r\n\x1b[31m[WebSocket error — connection failed]\x1b[0m\r\n")
      })

      // -----------------------------------------------------------------------
      // stdin: forward keystrokes as binary
      // -----------------------------------------------------------------------
      term.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(new TextEncoder().encode(data))
        }
      })

      // -----------------------------------------------------------------------
      // Resize: debounce 100 ms, then send JSON + refit
      // -----------------------------------------------------------------------
      term.onResize(({ cols: c, rows: r }: { cols: number; rows: number }) => {
        if (resizeTimerRef.current !== null) {
          clearTimeout(resizeTimerRef.current)
        }
        resizeTimerRef.current = setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "resize", cols: c, rows: r }))
          }
        }, 100)
      })

      // -----------------------------------------------------------------------
      // Auto-fit on container resize
      // -----------------------------------------------------------------------
      const ro = new ResizeObserver(() => {
        if (disposed) return
        fitAddon.fit()
      })
      if (containerRef.current) ro.observe(containerRef.current)
      resizeObserverRef.current = ro
    }

    void init()

    return () => {
      disposed = true

      if (resizeTimerRef.current !== null) {
        clearTimeout(resizeTimerRef.current)
        resizeTimerRef.current = null
      }

      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = null

      const ws = wsRef.current
      if (ws) {
        ws.close()
        wsRef.current = null
      }

      const term = termRef.current as { dispose?: () => void } | null
      if (term?.dispose) {
        term.dispose()
        termRef.current = null
      }
    }
  }, [appId])

  return (
    <div className="flex h-full w-full flex-col bg-[#09090b]">
      {/* xterm.js mounts here */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 min-w-0 overflow-hidden p-1"
        aria-label="Interactive shell terminal"
      />
    </div>
  )
}
