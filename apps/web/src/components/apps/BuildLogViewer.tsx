// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react";
import { apiFetch } from "../../lib/api";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_LINES = 10_000;
const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BuildLogViewerProps {
  /** App ID */
  appId: string;
  /** Build ID — if undefined or "latest", streams runtime logs */
  buildId?: string;
  className?: string;
}

interface LogLine {
  id: number;
  text: string;
}

// ---------------------------------------------------------------------------
// BuildLogViewer
// ---------------------------------------------------------------------------

export function BuildLogViewer({
  appId,
  buildId,
  className,
}: BuildLogViewerProps): React.JSX.Element {
  const [lines, setLines] = React.useState<Array<LogLine>>([] as Array<LogLine>);
  const [connected, setConnected] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const counterRef = React.useRef(0);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const followRef = React.useRef(true);
  const wsRef = React.useRef<WebSocket | null>(null);

  // Append lines with capping at MAX_LINES
  const appendLine = React.useCallback((text: string) => {
    setLines((prev) => {
      const id = ++counterRef.current;
      const next = [...prev, { id, text }];
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    });
  }, []);

  // Auto-scroll when follow is enabled
  React.useEffect(() => {
    if (!followRef.current) return;
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lines]);

  // Detect user scroll-up to stop following
  const handleScroll = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    followRef.current = atBottom;
  }, []);

  // Connect WebSocket
  React.useEffect(() => {
    setLines([]);
    setError(null);
    followRef.current = true;

    const wsBase = API_BASE.replace(/^http/, "ws");
    const path =
      buildId && buildId !== "latest"
        ? `${wsBase}/ws/apps/${appId}/build/${buildId}`
        : `${wsBase}/ws/apps/${appId}/logs`;

    let ws: WebSocket;
    let fallbackTriggered = false;

    const connectWs = (): void => {
      try {
        ws = new WebSocket(path);
        wsRef.current = ws;

        ws.onopen = () => {
          setConnected(true);
          setError(null);
        };

        ws.onmessage = (ev: MessageEvent<string>) => {
          const text = typeof ev.data === "string" ? ev.data : String(ev.data);
          appendLine(text);
        };

        ws.onerror = () => {
          if (!fallbackTriggered) {
            fallbackTriggered = true;
            triggerFallback();
          }
        };

        ws.onclose = (ev) => {
          setConnected(false);
          if (!ev.wasClean && !fallbackTriggered) {
            fallbackTriggered = true;
            triggerFallback();
          }
        };
      } catch {
        if (!fallbackTriggered) {
          fallbackTriggered = true;
          triggerFallback();
        }
      }
    };

    const triggerFallback = (): void => {
      setError("WebSocket unavailable — loading archived logs…");
      const logsPath =
        buildId && buildId !== "latest"
          ? `/apps/${appId}/logs?buildId=${buildId}`
          : `/apps/${appId}/logs`;
      apiFetch<{ lines: Array<string> }>(logsPath)
        .then((data) => {
          setError(null);
          for (const line of data.lines) {
            appendLine(line);
          }
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : "Failed to load logs";
          setError(msg);
        });
    };

    connectWs();

    return () => {
      wsRef.current = null;
      ws?.close();
    };
  }, [appId, buildId, appendLine]);

  return (
    <div
      className={[
        "flex flex-col rounded-lg border border-border bg-[#0d0d0d] font-mono text-xs overflow-hidden",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-1.5">
        <span
          className={[
            "size-2 rounded-full",
            connected ? "bg-green-500" : "bg-muted-foreground/40",
          ].join(" ")}
          aria-hidden="true"
        />
        <span className="text-muted-foreground text-[11px]">
          {connected ? "Live" : "Disconnected"}
        </span>
        {lines.length > 0 && (
          <span className="ml-auto text-muted-foreground/60 text-[11px]">
            {lines.length.toLocaleString()} lines
          </span>
        )}
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
        aria-label="Build logs"
      >
        {lines.length === 0 ? (
          <span className="text-muted-foreground/60">Waiting for logs…</span>
        ) : (
          lines.map((line) => (
            <div key={line.id} className="leading-relaxed whitespace-pre-wrap break-all text-[#e5e7eb]">
              {line.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
