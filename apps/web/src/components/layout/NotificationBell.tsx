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
import {
  
  
  useNotifications
} from "../../lib/notifications"
import type {NotificationEvent, NotificationType} from "../../lib/notifications";

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
  if (type === "build.succeeded" || type === "deploy.status_change" || type === "provider.sync.completed") {
    return <RiCheckboxCircleLine className="mt-0.5 size-4 shrink-0 text-emerald-500" />
  }
  if (type === "build.failed" || type === "provider.sync.failed") {
    return <RiCloseCircleLine className="mt-0.5 size-4 shrink-0 text-red-500" />
  }
  if (type === "provider.sync.started") {
    return <RiRefreshLine className="mt-0.5 size-4 shrink-0 text-blue-500" />
  }
  return <RiInformationLine className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
}

function NotificationItem({ item }: { item: NotificationEvent }): React.JSX.Element {
  return (
    <div className="flex items-start gap-2 px-3 py-2">
      {notificationIcon(item.type)}
      <div className="min-w-0 flex-1">
        <p className="text-xs leading-5">{item.message}</p>
        <p className="text-muted-foreground text-[10px]">{relativeTime(item.t)}</p>
      </div>
    </div>
  )
}

export function NotificationBell(): React.JSX.Element {
  const { state, markAllRead, clear } = useNotifications()
  const [open, setOpen] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)

  const badgeLabel =
    state.unreadCount > 9 ? "9+" : state.unreadCount > 0 ? String(state.unreadCount) : null

  const handleToggle = (): void => {
    setOpen((v) => !v)
  }

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
          "hover:bg-sidebar-accent/60 relative flex size-8 items-center justify-center rounded-full outline-none transition-colors",
          open && "bg-sidebar-accent/60",
        )}
      >
        {open ? (
          <RiNotification3Fill className="size-4" />
        ) : (
          <RiNotification3Line className="size-4" />
        )}

        {/* Unread badge */}
        {badgeLabel !== null ? (
          <span className="absolute -top-0.5 -right-0.5 flex min-w-[16px] items-center justify-center rounded-full bg-red-500 px-0.5 text-[9px] font-semibold text-white leading-4">
            {badgeLabel}
          </span>
        ) : null}
      </button>

      {/* Connected dot */}
      {state.connected ? (
        <span
          aria-hidden
          className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full bg-emerald-500 ring-1 ring-background animate-pulse"
        />
      ) : null}

      {/* Dropdown */}
      {open ? (
        <div className="border-border bg-popover absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-md border shadow-md">
          {/* Header */}
          <div className="border-border flex items-center justify-between border-b px-3 py-2">
            <span className="text-xs font-semibold">Notifications</span>
            <button
              type="button"
              onClick={clear}
              className="text-muted-foreground hover:text-foreground text-xs transition-colors"
            >
              Tout effacer
            </button>
          </div>

          {/* List */}
          <div className="max-h-96 overflow-y-auto">
            {state.items.length === 0 ? (
              <p className="text-muted-foreground px-3 py-6 text-center text-xs">
                Aucune notification
              </p>
            ) : (
              <ul className="divide-border divide-y">
                {state.items.map((item) => (
                  <li key={item.id}>
                    <NotificationItem item={item} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
