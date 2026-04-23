// SPDX-License-Identifier: AGPL-3.0-only
import type { AppStatus } from "@ploydok/shared"
import type { AppDetail, AppListItem, AppStatusEventPayload, RawAppDetail } from "./types"

export function normalizeAppDetail(raw: RawAppDetail): AppDetail {
  const { healthcheck, ...rest } = raw
  return {
    ...rest,
    healthcheckPath: healthcheck?.path ?? undefined,
    healthcheckPort: healthcheck?.port ?? null,
    healthcheckIntervalS: healthcheck?.intervalS ?? null,
    healthcheckTimeoutS: healthcheck?.timeoutS ?? null,
    healthcheckRetries: healthcheck?.retries ?? null,
    healthcheckStartPeriodS: healthcheck?.startPeriodS ?? null,
  }
}

export function applyAppStatus(
  app: AppDetail | AppListItem | undefined,
  status: AppStatus,
): AppDetail | AppListItem | undefined {
  if (!app) return app
  return { ...app, status }
}

export function getEventAppStatus(payload: AppStatusEventPayload): AppStatus | undefined {
  return payload.data?.status
}
