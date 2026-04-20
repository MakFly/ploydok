// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import {
  Link,
  Outlet,
  createFileRoute,
  useRouterState,
} from "@tanstack/react-router"
import {
  RiArrowRightSLine,
  RiFingerprintLine,
  RiKey2Line,
  RiMacbookLine,
  RiShieldKeyholeLine,
  RiShieldCheckLine,
} from "@remixicon/react"
import { cn } from "@workspace/ui/lib/utils"
import { ShellPage } from "../../../components/layout/AppShell"
import { SettingsTabs } from "../../../components/settings/SettingsTabs"
import { useMe } from "../../../lib/auth"
import { usePasskeys } from "../../../lib/passkeys"
import { useSessions } from "../../../lib/sessions"

export const Route = createFileRoute("/_authed/settings/security")({
  component: SecurityLayout,
})

type PostureStatus = "strong" | "fair" | "weak"

interface PostureSignal {
  label: string
  verdict: string
  hint: string
  status: PostureStatus
  icon: React.ComponentType<{ className?: string }>
  to?: string
}

function SecurityLayout(): React.JSX.Element {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { data: me } = useMe()
  const { data: passkeys } = usePasskeys()
  const { data: sessions } = useSessions()

  const passkeyCount = passkeys?.length ?? 0
  const otherSessions = sessions?.filter((s) => !s.is_current).length ?? 0
  const hasBackupCodes = me?.has_backup_codes ?? false

  const passkeyStatus: PostureStatus =
    passkeyCount >= 2 ? "strong" : passkeyCount === 1 ? "fair" : "weak"
  const backupStatus: PostureStatus = hasBackupCodes ? "strong" : "weak"
  const sessionStatus: PostureStatus =
    otherSessions === 0 ? "strong" : otherSessions <= 2 ? "fair" : "weak"

  const signals: Array<PostureSignal> = [
    {
      label: "Passkeys",
      verdict:
        passkeyCount === 0
          ? "No passkey registered"
          : `${passkeyCount} registered`,
      hint:
        passkeyCount >= 2
          ? "Two or more devices can sign in."
          : passkeyCount === 1
            ? "Add a second device as a fallback."
            : "Required to access your workspace.",
      status: passkeyStatus,
      icon: RiFingerprintLine,
      to: "/settings/security/passkeys",
    },
    {
      label: "Backup codes",
      verdict: hasBackupCodes ? "Codes issued" : "Not configured",
      hint: hasBackupCodes
        ? "Recovery path active if a device is lost."
        : "Generated from the CLI — ask an owner to run ploydok-cli admin-recovery.",
      status: backupStatus,
      icon: RiKey2Line,
    },
    {
      label: "Active sessions",
      verdict:
        otherSessions === 0
          ? "Only this device"
          : `${otherSessions + 1} devices`,
      hint:
        otherSessions === 0
          ? "No shadow logins to audit."
          : "Review other devices and revoke anything unfamiliar.",
      status: sessionStatus,
      icon: RiMacbookLine,
      to: "/settings/security/sessions",
    },
  ]

  return (
    <ShellPage
      title="Security"
      description="Lock down who can reach your Ploydok workspace. Manage passkeys, audit open sessions, and keep a recovery path in reserve."
      eyebrow="Settings · Account"
    >
      <div className="space-y-6">
        <PostureCard signals={signals} />

        <div className="space-y-4">
          <SettingsTabs />
          <SecuritySubTabs pathname={pathname} />
        </div>

        <Outlet />
      </div>
    </ShellPage>
  )
}

function PostureCard({
  signals,
}: {
  signals: Array<PostureSignal>
}): React.JSX.Element {
  return (
    <section
      aria-label="Security posture"
      className="relative overflow-hidden rounded-xl border border-border bg-card"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,var(--muted)_0%,transparent_60%)] opacity-70"
      />
      <div className="relative grid gap-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.8fr)]">
        <div className="flex flex-col justify-between gap-6 border-b border-border p-5 md:border-r md:border-b-0">
          <div className="flex items-start gap-3">
            <div className="flex size-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <RiShieldKeyholeLine className="size-5" />
            </div>
            <div className="space-y-1">
              <p className="font-mono text-[10px] font-light tracking-wide text-muted-foreground uppercase">
                Posture
              </p>
              <h2 className="font-heading text-lg leading-tight font-medium">
                Your account perimeter
              </h2>
            </div>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Three signals drive access safety: the passkeys you hold, the
            backup codes in reserve, and the devices currently signed in.
          </p>
        </div>
        <ul className="divide-y divide-border">
          {signals.map((s) => (
            <PostureRow key={s.label} signal={s} />
          ))}
        </ul>
      </div>
    </section>
  )
}

const STATUS_STYLES: Record<
  PostureStatus,
  { dot: string; text: string; label: string }
> = {
  strong: {
    dot: "bg-emerald-500 shadow-[0_0_0_4px] shadow-emerald-500/10",
    text: "text-emerald-600 dark:text-emerald-400",
    label: "Strong",
  },
  fair: {
    dot: "bg-amber-500 shadow-[0_0_0_4px] shadow-amber-500/10",
    text: "text-amber-600 dark:text-amber-400",
    label: "Fair",
  },
  weak: {
    dot: "bg-destructive shadow-[0_0_0_4px] shadow-destructive/10",
    text: "text-destructive",
    label: "Weak",
  },
}

function PostureRow({
  signal,
}: {
  signal: PostureSignal
}): React.JSX.Element {
  const { dot, text, label } = STATUS_STYLES[signal.status]
  const Icon = signal.icon
  const inner = (
    <div
      className={cn(
        "flex items-center gap-4 p-4 transition-colors",
        signal.to && "group-hover:bg-muted/50"
      )}
    >
      <div className="relative">
        <span
          aria-hidden
          className={cn(
            "absolute top-1 left-1 size-2 rounded-full",
            dot
          )}
        />
        <div className="flex size-10 items-center justify-center rounded-md border border-border bg-background">
          <Icon className="size-4 text-muted-foreground" />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <p className="text-sm font-medium">{signal.label}</p>
          <p
            className={cn(
              "font-mono text-[10px] tracking-wide uppercase",
              text
            )}
          >
            {label}
          </p>
        </div>
        <p className="truncate text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{signal.verdict}</span>
          <span className="mx-1.5 opacity-40">·</span>
          {signal.hint}
        </p>
      </div>
      {signal.to && (
        <RiArrowRightSLine className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </div>
  )
  return (
    <li className="group">
      {signal.to ? (
        <Link to={signal.to} className="block outline-none">
          {inner}
        </Link>
      ) : (
        inner
      )}
    </li>
  )
}

function SecuritySubTabs({
  pathname,
}: {
  pathname: string
}): React.JSX.Element {
  const subs = [
    {
      to: "/settings/security/passkeys",
      label: "Passkeys",
      icon: RiFingerprintLine,
    },
    {
      to: "/settings/security/sessions",
      label: "Sessions",
      icon: RiMacbookLine,
    },
    {
      to: "/settings/security/totp",
      label: "TOTP",
      icon: RiShieldCheckLine,
    },
  ] as const
  return (
    <nav
      aria-label="Security sections"
      className="flex flex-wrap gap-1 border-b border-border"
    >
      {subs.map(({ to, label, icon: Icon }) => {
        const active = pathname === to
        return (
          <Link
            key={to}
            to={to}
            className={cn(
              "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}

