// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import {
  RiCheckboxCircleLine,
  RiCloseCircleLine,
  RiInformationLine,
  RiNotification3Fill,
  RiNotification3Line,
  RiRefreshLine,
} from "@remixicon/react"
import { useNavigate } from "@tanstack/react-router"
import { resolveNotificationHref } from "../../lib/notification-destinations"
import { useNotifications } from "../../lib/notifications"
import { useCurrentOrganizationSlug } from "../../lib/organizations"
import type {
  NotificationEvent,
  NotificationType,
} from "../../lib/notifications"

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ")
}

function relativeTime(t: number): string {
  const diffMs = Date.now() - t
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return "il y a quelques secondes"
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `il y a ${diffMin} min`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `il y a ${diffH} h`
  const diffD = Math.floor(diffH / 24)
  return `il y a ${diffD} j`
}

function notificationIcon(type: NotificationType): React.JSX.Element {
  if (
    type === "build.succeeded" ||
    type === "deploy.status_change" ||
    type === "provider.sync.completed" ||
    type === "app.deleted" ||
    type === "app.stopped"
  ) {
    return (
      <RiCheckboxCircleLine className="mt-0.5 size-4 shrink-0 text-emerald-500" />
    )
  }
  if (
    type === "build.failed" ||
    type === "build.cancelled" ||
    type === "provider.sync.failed" ||
    type === "app.delete.failed" ||
    type === "app.stop.failed"
  ) {
    return <RiCloseCircleLine className="mt-0.5 size-4 shrink-0 text-red-500" />
  }
  if (
    type === "provider.sync.started" ||
    type === "app.delete.queued" ||
    type === "app.stop.queued"
  ) {
    return <RiRefreshLine className="mt-0.5 size-4 shrink-0 text-blue-500" />
  }
  return (
    <RiInformationLine className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
  )
}

function NotificationItemContent({
  item,
}: {
  item: NotificationEvent
}): React.JSX.Element {
  return (
    <>
      {notificationIcon(item.type)}
      <div className="min-w-0 flex-1">
        <p className="text-xs leading-5 break-words">{item.message}</p>
        <p className="text-[10px] text-muted-foreground">
          {relativeTime(item.t)}
        </p>
      </div>
    </>
  )
}

function NotificationItem({
  item,
  href,
  onNavigate,
}: {
  item: NotificationEvent
  href: string | null
  onNavigate: (href: string) => void
}): React.JSX.Element {
  if (!href) {
    return (
      <div className="flex items-start gap-2 px-3 py-2">
        <NotificationItemContent item={item} />
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onNavigate(href)}
      className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors outline-none hover:bg-muted/70 focus-visible:bg-muted/70"
    >
      <NotificationItemContent item={item} />
    </button>
  )
}

export function NotificationBell(): React.JSX.Element {
  const { state, markAllRead, clear } = useNotifications()
  const navigate = useNavigate()
  const orgSlug = useCurrentOrganizationSlug()
  const [open, setOpen] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)

  const badgeLabel =
    state.unreadCount > 9
      ? "9+"
      : state.unreadCount > 0
        ? String(state.unreadCount)
        : null

  const handleToggle = (): void => {
    setOpen((v) => !v)
  }

  const handleNavigate = React.useCallback(
    (href: string): void => {
      setOpen(false)
      void navigate({ href })
    },
    [navigate]
  )

  // Mark all read when the popover closes (open: true → false).
  const prevOpenRef = React.useRef(open)
  React.useEffect(() => {
    if (prevOpenRef.current && !open) {
      markAllRead()
    }
    prevOpenRef.current = open
  }, [open, markAllRead])

  React.useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent): void => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener("click", handleClick)
    return () => document.removeEventListener("click", handleClick)
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      {/* Bell button */}
      <button
        type="button"
        onClick={handleToggle}
        aria-label="Notifications"
        aria-expanded={open}
        className={cx(
          "relative flex size-8 items-center justify-center rounded-full transition-colors outline-none hover:bg-sidebar-accent/60",
          open && "bg-sidebar-accent/60"
        )}
      >
        {open ? (
          <RiNotification3Fill className="size-4" />
        ) : (
          <RiNotification3Line className="size-4" />
        )}

        {/* Unread badge */}
        {badgeLabel !== null ? (
          <span className="absolute -top-0.5 -right-0.5 flex min-w-[16px] items-center justify-center rounded-full bg-red-500 px-0.5 text-[9px] leading-4 font-semibold text-white">
            {badgeLabel}
          </span>
        ) : null}
      </button>

      {/* Connected dot */}
      {state.connected ? (
        <span
          aria-hidden
          className="absolute -right-0.5 -bottom-0.5 size-2 animate-pulse rounded-full bg-emerald-500 ring-1 ring-background"
        />
      ) : null}

      {/* Dropdown */}
      {open ? (
        <div className="fixed top-14 right-2 left-2 z-50 overflow-hidden rounded-md border border-border bg-popover shadow-md sm:absolute sm:top-full sm:right-0 sm:left-auto sm:mt-2 sm:w-[min(20rem,calc(100vw-2rem))]">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-semibold">Notifications</span>
            <button
              type="button"
              onClick={clear}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Tout effacer
            </button>
          </div>

          {/* List — only unread items. Read items stay in `state.items` so
              the dedup-by-id check still works against SSE replay, but the
              dropdown stays focused on what the user hasn't seen yet. */}
          <div className="max-h-[60vh] overflow-y-auto sm:max-h-96">
            {(() => {
              const unread = state.items.filter((it) => it.t > state.lastReadAt)
              if (unread.length === 0) {
                return (
                  <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                    Aucune nouvelle notification
                  </p>
                )
              }
              return (
                <ul className="divide-y divide-border">
                  {unread.map((item) => (
                    <li key={item.id}>
                      <NotificationItem
                        item={item}
                        href={resolveNotificationHref(item, orgSlug)}
                        onNavigate={handleNavigate}
                      />
                    </li>
                  ))}
                </ul>
              )
            })()}
          </div>
        </div>
      ) : null}
    </div>
  )
}
