// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useTranslation } from "react-i18next"
import { RiHistoryLine, RiTimeLine } from "@remixicon/react"
import { Button } from "@workspace/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import type { SessionInfo } from "@ploydok/shared"

function formatDate(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

function sessionLabel(session: SessionInfo, unknownBrowser: string): string {
  if (/Edg\//i.test(session.user_agent)) return "Microsoft Edge"
  if (/OPR\//i.test(session.user_agent)) return "Opera"
  if (/Firefox\//i.test(session.user_agent)) return "Firefox"
  if (/Chrome\//i.test(session.user_agent)) return "Chrome"
  if (/Safari\//i.test(session.user_agent)) return "Safari"
  return unknownBrowser
}

export function SessionHistoryPopover({
  sessions,
}: {
  sessions: Array<SessionInfo>
}): React.JSX.Element {
  const { t } = useTranslation("settings")
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-label={t("sessions.historyAria")}
        >
          <RiHistoryLine aria-hidden="true" />
          {t("sessions.history")}
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label={t("sessions.historyTitle")}>
        <PopoverHeader>
          <PopoverTitle>{t("sessions.historyTitle")}</PopoverTitle>
          <PopoverDescription>{t("sessions.historyHint")}</PopoverDescription>
        </PopoverHeader>

        {sessions.length > 0 ? (
          <ol className="space-y-3" aria-label={t("sessions.historyEntries")}>
            {sessions.map((session) => (
              <li
                key={session.id}
                className="relative pl-5 text-xs before:absolute before:top-1.5 before:left-0 before:size-2 before:rounded-full before:bg-primary before:ring-4 before:ring-primary/10"
              >
                <p className="font-medium text-foreground">
                  {sessionLabel(session, t("sessions.unknownBrowser"))}
                  {session.is_current ? t("sessions.thisDeviceSuffix") : ""}
                </p>
                <p className="mt-0.5 flex items-center gap-1 text-muted-foreground">
                  <RiTimeLine className="size-3" aria-hidden="true" />
                  {t("sessions.signedIn", {
                    when: formatDate(session.created_at),
                  })}
                </p>
                <dl className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                  <div className="flex justify-between gap-3">
                    <dt>{t("sessions.lastActivity")}</dt>
                    <dd className="text-right text-foreground/80">
                      {formatDate(session.last_seen_at)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>{t("sessions.expires")}</dt>
                    <dd className="text-right text-foreground/80">
                      {formatDate(session.expires_at)}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ol>
        ) : (
          <p className="py-4 text-center text-xs text-muted-foreground">
            {t("sessions.historyEmpty")}
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}
