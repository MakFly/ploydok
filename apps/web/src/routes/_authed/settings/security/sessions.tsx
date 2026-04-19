// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import {
  RiCloseCircleLine,
  RiComputerLine,
  RiErrorWarningLine,
  RiGlobalLine,
  RiLoader4Line,
  RiMapPinLine,
  RiRadarLine,
  RiShieldCheckLine,
  RiSmartphoneLine,
  RiTimeLine,
} from "@remixicon/react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import {
  useRevokeOthers,
  useRevokeSession,
  useSessions,
} from "../../../../lib/sessions"
import type { SessionInfo } from "@ploydok/shared"

export const Route = createFileRoute("/_authed/settings/security/sessions")({
  component: SessionsPage,
})

function SessionsPage(): React.JSX.Element {
  const { data: sessions, isLoading, error } = useSessions()
  const revokeOthers = useRevokeOthers()

  if (error) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <p role="alert" className="flex items-center gap-1.5 text-sm text-destructive">
          <RiErrorWarningLine className="size-4" />
          Failed to load sessions: {error.message}
        </p>
      </section>
    )
  }

  const others = sessions?.filter((s) => !s.is_current) ?? []
  const current = sessions?.find((s) => s.is_current)
  const sorted = [...(sessions ?? [])].sort((a, b) =>
    a.is_current === b.is_current ? 0 : a.is_current ? -1 : 1
  )

  return (
    <div className="space-y-5">
      <section
        className={cn(
          "relative overflow-hidden rounded-lg border p-4",
          "border-emerald-500/30 bg-emerald-500/[0.04]"
        )}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_bottom_right,var(--color-chart-1)_0%,transparent_60%)] opacity-10"
        />
        <div className="relative flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <RiRadarLine className="size-5" />
            </div>
            <div className="space-y-0.5">
              <p className="font-mono text-[10px] tracking-wide text-emerald-700 uppercase dark:text-emerald-300">
                Live fleet
              </p>
              <h3 className="text-sm font-medium">
                {sessions?.length ?? 0}{" "}
                {sessions?.length === 1 ? "active session" : "active sessions"}
              </h3>
              <p className="text-xs text-muted-foreground">
                {others.length === 0
                  ? "Only this device is signed in."
                  : `${others.length} other ${
                      others.length === 1 ? "device is" : "devices are"
                    } signed in right now.`}
              </p>
            </div>
          </div>
          {others.length > 0 ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  <RiCloseCircleLine />
                  Sign out {others.length} other
                  {others.length === 1 ? "" : "s"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogMedia>
                    <RiCloseCircleLine />
                  </AlertDialogMedia>
                  <AlertDialogTitle>
                    Sign out all other devices?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    Every device except this one will be signed out
                    immediately. They will have to re-authenticate with a
                    passkey to regain access.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={() => revokeOthers.mutate()}
                  >
                    {revokeOthers.isPending
                      ? "Signing out…"
                      : "Sign them out"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </div>
      </section>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between px-1">
          <p className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
            Devices
          </p>
          {current ? (
            <p className="font-mono text-[10px] text-muted-foreground">
              This session expires{" "}
              <span title={new Date(current.expires_at).toLocaleString()}>
                {relativeTime(current.expires_at, true)}
              </span>
            </p>
          ) : null}
        </div>

        {isLoading ? (
          <div className="rounded-lg border border-border border-dashed p-4">
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <RiLoader4Line className="size-3.5 animate-spin" />
              Loading sessions…
            </p>
          </div>
        ) : sorted.length > 0 ? (
          <ul className="space-y-2">
            {sorted.map((session) => (
              <SessionRow key={session.id} session={session} />
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border border-dashed bg-muted/20 px-4 py-10 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-muted">
              <RiComputerLine className="size-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">No active sessions</p>
          </div>
        )}
      </div>

      {current ? (
        <p className="text-xs text-muted-foreground">
          To end your current session, use{" "}
          <span className="font-medium text-foreground">Sign out</span> from
          the sidebar user menu.
        </p>
      ) : null}
    </div>
  )
}

interface ParsedUA {
  os: string
  browser: string
  icon: React.ComponentType<{ className?: string }>
}

function parseUA(ua: string): ParsedUA {
  let os = "Unknown OS"
  let browser = "Unknown browser"
  if (/Windows/i.test(ua)) os = "Windows"
  else if (/iPhone/i.test(ua)) os = "iPhone"
  else if (/iPad/i.test(ua)) os = "iPad"
  else if (/Android/i.test(ua)) os = "Android"
  else if (/Mac OS X|Macintosh/i.test(ua)) os = "macOS"
  else if (/Linux/i.test(ua)) os = "Linux"

  if (/Edg\//i.test(ua)) browser = "Edge"
  else if (/OPR\/|Opera/i.test(ua)) browser = "Opera"
  else if (/Firefox\//i.test(ua)) browser = "Firefox"
  else if (/Chrome\//i.test(ua)) browser = "Chrome"
  else if (/Safari\//i.test(ua)) browser = "Safari"

  const icon =
    os === "iPhone" || os === "iPad" || os === "Android"
      ? RiSmartphoneLine
      : os === "Unknown OS"
        ? RiGlobalLine
        : RiComputerLine

  return { os, browser, icon }
}

function SessionRow({
  session,
}: {
  session: SessionInfo
}): React.JSX.Element {
  const revoke = useRevokeSession()
  const { os, browser, icon: Icon } = parseUA(session.user_agent)
  const pending = revoke.isPending && revoke.variables === session.id
  const lastSeenAbs = new Date(session.last_seen_at).toLocaleString()

  return (
    <li
      className={cn(
        "relative rounded-lg border bg-card transition-colors",
        session.is_current
          ? "border-emerald-500/30 ring-1 ring-emerald-500/10"
          : "border-border hover:bg-muted/30"
      )}
    >
      <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:gap-4">
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-md",
            session.is_current
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "bg-muted text-muted-foreground"
          )}
        >
          <Icon className="size-4" />
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium">
              {browser}{" "}
              <span className="text-muted-foreground">on {os}</span>
            </p>
            {session.is_current ? (
              <span className="relative inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
                </span>
                This device
              </span>
            ) : null}
          </div>

          <dl className="flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
            <div className="flex items-center gap-1">
              <dt className="flex items-center gap-1 opacity-60">
                <RiMapPinLine className="size-3" />
                ip
              </dt>
              <dd className="text-foreground/80">{session.ip}</dd>
            </div>
            <div className="flex items-center gap-1">
              <dt className="flex items-center gap-1 opacity-60">
                <RiTimeLine className="size-3" />
                last seen
              </dt>
              <dd title={lastSeenAbs} className="text-foreground/80">
                {relativeTime(session.last_seen_at)}
              </dd>
            </div>
          </dl>

          <p
            className="truncate font-mono text-[10px] text-muted-foreground/70"
            title={session.user_agent}
          >
            {session.user_agent}
          </p>
        </div>

        <div className="shrink-0">
          {session.is_current ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
              <RiShieldCheckLine className="size-3.5" />
              Trusted
            </span>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Revoke session on ${browser} / ${os}`}
                >
                  <RiCloseCircleLine />
                  Revoke
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogMedia>
                    <RiCloseCircleLine />
                  </AlertDialogMedia>
                  <AlertDialogTitle>Revoke this session?</AlertDialogTitle>
                  <AlertDialogDescription>
                    <span className="font-medium text-foreground">
                      {browser} on {os}
                    </span>{" "}
                    (<span className="font-mono">{session.ip}</span>) will be
                    signed out immediately.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={() => revoke.mutate(session.id)}
                  >
                    Revoke session
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>
    </li>
  )
}

function relativeTime(iso: string, future = false): string {
  const now = Date.now()
  const then = new Date(iso).getTime()
  const diff = future ? then - now : now - then
  if (diff <= 0) return future ? "any moment" : "just now"
  const s = Math.floor(diff / 1000)
  const prefix = future ? "in " : ""
  const suffix = future ? "" : " ago"
  if (s < 45) return future ? "in a moment" : "just now"
  const m = Math.floor(s / 60)
  if (m < 60) return `${prefix}${m}m${suffix}`
  const h = Math.floor(m / 60)
  if (h < 24) return `${prefix}${h}h${suffix}`
  const d = Math.floor(h / 24)
  if (d < 7) return `${prefix}${d}d${suffix}`
  const w = Math.floor(d / 7)
  if (w < 5) return `${prefix}${w}w${suffix}`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${prefix}${mo}mo${suffix}`
  return `${prefix}${Math.floor(d / 365)}y${suffix}`
}
