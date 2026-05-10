// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { apiWebSocketBaseUrl } from "../../lib/api/base"
import { apiFetch } from "../../lib/api/client"
import { FileBrowser } from "./FileBrowser"

// ---------------------------------------------------------------------------
// Shell — xterm.js terminal wired to a WebSocket exec session.
//
// Protocol (locked with API):
//   binary client→server = stdin bytes
//   binary server→client = stdout bytes
//   text JSON client→server = {"type":"resize","cols":N,"rows":N}
//   text JSON server→client = {"type":"ready"} | {"type":"exit","code":N}
//                          | {"type":"error","message":"..."}
// Close codes: 4001=Unauthorized, 4004=AppNotFound, 1001=Idle, 1011=InternalError
// ---------------------------------------------------------------------------

interface ShellProps {
  appId: string
}

type ShellMode = "ro" | "rw"

function closeReason(code: number): string {
  switch (code) {
    case 4001:
      return "Unauthorized"
    case 4003:
      return "Write access requires a fresh second-factor check"
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
  const [mode, setMode] = React.useState<ShellMode>("ro")
  const containerRef = React.useRef<HTMLDivElement>(null)
  const termRef = React.useRef<unknown>(null)
  const wsRef = React.useRef<WebSocket | null>(null)
  const fitRef = React.useRef<unknown>(null)
  const resizeObserverRef = React.useRef<ResizeObserver | null>(null)
  const resizeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null
  )

  React.useEffect(() => {
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
      term.open(containerRef.current)
      fitAddon.fit()

      termRef.current = term
      fitRef.current = fitAddon

      const { cols, rows } = term
      const wsBase = apiWebSocketBaseUrl()
      const url = `${wsBase}/ws/apps/${appId}/exec?cols=${cols}&rows=${rows}&mode=${mode}`

      term.write(
        `\x1b[2mConnecting to ${mode === "rw" ? "write" : "read-only"} shell…\x1b[0m\r\n`
      )

      const ws = new WebSocket(url)
      ws.binaryType = "arraybuffer"
      wsRef.current = ws

      ws.addEventListener("open", () => {
        if (disposed) {
          ws.close()
          return
        }
      })

      ws.addEventListener("message", (evt: MessageEvent) => {
        if (disposed) return
        if (typeof evt.data === "string") {
          try {
            const msg = JSON.parse(evt.data) as {
              type: string
              code?: number
              message?: string
            }
            if (msg.type === "ready") {
              term.reset()
            } else if (msg.type === "exit") {
              term.write(
                `\r\n\x1b[2m[process exited with code ${msg.code ?? 0}]\x1b[0m\r\n`
              )
            } else if (msg.type === "error") {
              term.write(
                `\r\n\x1b[31m[error: ${msg.message ?? "unknown error"}]\x1b[0m\r\n`
              )
            }
          } catch {
            // Ignore malformed JSON
          }
        } else {
          term.write(new Uint8Array(evt.data as ArrayBuffer))
        }
      })

      ws.addEventListener("close", (evt: CloseEvent) => {
        if (disposed) return
        if (evt.code !== 1000) {
          term.write(`\r\n\x1b[33m[${closeReason(evt.code)}]\x1b[0m\r\n`)
        }
      })

      ws.addEventListener("error", () => {
        if (disposed) return
        term.write(
          "\r\n\x1b[31m[WebSocket error — connection failed]\x1b[0m\r\n"
        )
      })

      term.onData((data: string) => {
        if (mode === "rw" && ws.readyState === WebSocket.OPEN) {
          ws.send(new TextEncoder().encode(data))
        }
      })

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
  }, [appId, mode])

  async function toggleWriteMode(): Promise<void> {
    if (mode === "rw") {
      setMode("ro")
      return
    }

    const confirmed = window.confirm("Enable write access for this terminal?")
    if (!confirmed) return

    const code = window.prompt("TOTP code")
    if (!code) return

    await apiFetch("/auth/second-factor/verify", {
      method: "POST",
      headers: { "X-TOTP-Code": code },
    })
    setMode("rw")
  }

  return (
    <div className="flex h-full w-full">
      <div className="flex min-w-0 flex-1 flex-col bg-[#09090b]">
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-zinc-800 px-3">
          <span className="font-mono text-[12px] tracking-normal text-zinc-400 uppercase">
            {mode === "rw" ? "write" : "read-only"}
          </span>
          <button
            type="button"
            onClick={() => void toggleWriteMode()}
            className="rounded-md border border-zinc-700 px-2.5 py-1 text-[12px] font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-800"
          >
            {mode === "rw" ? "Disable write" : "Enable write"}
          </button>
        </div>
        <div
          ref={containerRef}
          className="min-h-0 min-w-0 flex-1 overflow-hidden p-1 [&_.xterm-viewport]:scrollbar-thin"
          aria-label="Interactive shell terminal"
        />
      </div>
      <FileBrowser appId={appId} />
    </div>
  )
}
