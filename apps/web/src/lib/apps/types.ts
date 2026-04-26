// SPDX-License-Identifier: AGPL-3.0-only
import type { AppStatus, Build, RestartPolicy } from "@ploydok/shared"

export interface AppListItem {
  id: string
  organizationId?: string
  projectId?: string
  name: string
  slug: string
  status: AppStatus
  branch?: string
  domain?: string
  publicUrl?: string
  repoFullName?: string
  /** apps.container_id — the canonical container the runner wrote at last
   * successful deploy. Null when the app has never been deployed. */
  containerId?: string | null
  createdAt: number
  updatedAt: number
}

export interface AppDetail extends AppListItem {
  gitProvider?: string
  rootDir?: string
  dockerfilePath?: string
  nixpacksConfigPath?: string
  nodeVersion?: string
  installCommand?: string
  buildCommand?: string
  startCommand?: string
  buildMethod?: string
  runtimePort?: number | null
  restartPolicy?: RestartPolicy
  currentCommitSha?: string
  latestBuildId?: string
  healthcheckPath?: string
  healthcheckPort?: number | null
  // Healthcheck timing fields (W2.B fix — were silently dropped by normalizeAppDetail)
  healthcheckIntervalS?: number | null
  healthcheckTimeoutS?: number | null
  healthcheckRetries?: number | null
  healthcheckStartPeriodS?: number | null
  // Auto-deploy + webhook settings (sprint 3.1.1)
  autoDeployEnabled?: boolean
  postCommitStatus?: boolean
  coalescePushes?: boolean
  deployOnTag?: boolean
  tagPattern?: string | null
  webhookSecret?: boolean
  // Deploy hooks (Wave 5)
  hooksPreDeploy?: string | null
  hooksPostDeploy?: string | null
  hooksTimeoutS?: number | null
  // Last 10 builds included in GET /apps/:id response
  builds?: Array<Build>
}

export interface AppsResponse {
  apps: Array<AppListItem>
}

export interface BuildsResponse {
  builds: Array<Build>
}

// Backend serializes healthcheck as a nested object. Normalize to the flat
// shape used by the UI (forms, caches, components read `app.healthcheckPath`
// and `app.healthcheckPort` directly).
export interface RawAppDetail extends Omit<
  AppDetail,
  | "healthcheckPath"
  | "healthcheckPort"
  | "healthcheckIntervalS"
  | "healthcheckTimeoutS"
  | "healthcheckRetries"
  | "healthcheckStartPeriodS"
> {
  healthcheck?: {
    path?: string | null
    port?: number | null
    intervalS?: number | null
    timeoutS?: number | null
    retries?: number | null
    startPeriodS?: number | null
  } | null
}

export type AppSettingsPatch = Partial<
  Pick<
    AppDetail,
    | "branch"
    | "rootDir"
    | "dockerfilePath"
    | "nixpacksConfigPath"
    | "nodeVersion"
    | "installCommand"
    | "buildCommand"
    | "startCommand"
    | "buildMethod"
    | "runtimePort"
    | "restartPolicy"
    | "healthcheckPath"
    | "healthcheckPort"
    | "autoDeployEnabled"
    | "postCommitStatus"
    | "coalescePushes"
    | "deployOnTag"
    | "tagPattern"
    | "hooksPreDeploy"
    | "hooksPostDeploy"
    | "hooksTimeoutS"
  >
>

export interface AppStatusEventPayload {
  appId?: string
  data?: {
    status?: AppStatus
  }
}

export interface UseAppOptions {
  /** Seed TanStack Query's cache with pre-fetched data (e.g. from a route loader). */
  initialData?: AppDetail
}

export interface UseBuildsOptions {
  /** Seed TanStack Query's cache with pre-fetched data (e.g. from a route loader or GET /apps/:id). */
  initialData?: Array<Build>
}

export interface RegistryUsage {
  tags: number
  bytes: number
  diskPct: number
}

export interface BuildWithApp extends Build {
  appName: string
}
