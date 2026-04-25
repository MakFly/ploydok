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
  const resizeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null
  )

  // Read-only par défaut (Sprint 6.5-ter). Toggle « Enable write » ouvre une
  // nouvelle session WS avec ?mode=rw — un second challenge passkey sera
  // câblé après. Pour l'instant l'opt-in client-side suffit comme garde-fou
  // visible : l'utilisateur sait qu'il passe en mode destructif.
  const [mode, setMode] = React.useState<"ro" | "rw">("ro")

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

      // Mode rw : r\u00e9cup\u00e8re un ticket sign\u00e9 fresh (gated par 2FA c\u00f4t\u00e9 serveur).
      // Si la requ\u00eate \u00e9choue (403 totp_required, etc.) on retombe en read-only.
      let ticket: string | null = null
      if (mode === "rw") {
        term.write("\x1b[2mRequesting write ticket\u2026\x1b[0m\r\n")
        try {
          const res = await fetch(
            `${API_BASE}/apps/${appId}/exec/ticket?mode=rw`,
            {
              method: "POST",
              credentials: "include",
              headers: {
                "x-csrf-token":
                  document.cookie.match(/csrf=([^;]+)/)?.[1] ?? "",
              },
            }
          )
          if (!res.ok) {
            const body = await res.json().catch(() => ({}))
            const reason =
              (body as { code?: string; error?: { code?: string } })?.code ??
              (body as { error?: { code?: string } }).error?.code ??
              `HTTP ${res.status}`
            term.write(
              `\x1b[31m[write ticket refused: ${reason}] \u2014 falling back to read-only\x1b[0m\r\n`
            )
            setMode("ro")
            return
          }
          const data = (await res.json()) as { ticket: string }
          ticket = data.ticket
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          term.write(
            `\x1b[31m[ticket fetch failed: ${msg}] \u2014 falling back to read-only\x1b[0m\r\n`
          )
          setMode("ro")
          return
        }
      }

      const ticketParam = ticket ? `&ticket=${encodeURIComponent(ticket)}` : ""
      const url = `${wsBase}/ws/apps/${appId}/exec?cols=${cols}&rows=${rows}&mode=${mode}${ticketParam}`

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
          // Binary: stdout from the container
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
  }, [appId, mode])

  function toggleWriteMode() {
    if (mode === "ro") {
      const ok = window.confirm(
        "Activer le mode écriture ?\n\nUn second challenge passkey sera requis en prod (pas encore câblé). En attendant, tu prends la responsabilité d'exécuter des commandes destructives."
      )
      if (!ok) return
      setMode("rw")
    } else {
      setMode("ro")
    }
  }

  return (
    <div className="flex h-full w-full flex-col bg-[#09090b]">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex h-1.5 w-1.5 rounded-full ${
              mode === "rw" ? "bg-amber-500" : "bg-emerald-500"
            }`}
            aria-hidden
          />
          <span className="font-mono text-[10px] tracking-wide text-zinc-400 uppercase">
            {mode === "rw" ? "Read-write" : "Read-only"}
          </span>
        </div>
        <button
          type="button"
          onClick={toggleWriteMode}
          className={`inline-flex h-6 items-center rounded-md border px-2 font-mono text-[10px] transition-colors ${
            mode === "rw"
              ? "border-amber-500/50 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
              : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
          }`}
        >
          {mode === "rw" ? "Switch to read-only" : "Enable write"}
        </button>
      </div>
      <div
        ref={containerRef}
        className="min-h-0 min-w-0 flex-1 overflow-hidden p-1"
        aria-label="Interactive shell terminal"
      />
    </div>
  )
}
