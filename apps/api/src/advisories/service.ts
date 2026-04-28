// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { readFileSync } from "node:fs"
import path from "node:path"
import { and, eq, isNull, notInArray } from "drizzle-orm"
import {
  auditApp,
  collectManifestDependencies,
  dependencyQueryKey,
  fetchOsvVulnerability,
  queryOsvForDependencies,
  type FoundDependency,
  type ManifestSnapshot,
  type OsvVulnerabilityDetail,
} from "@ploydok/app-auditor"
import {
  app_manifests,
  apps,
  cve_advisories,
  cve_matches,
  memberships,
  projects,
} from "@ploydok/db"
import type { Db, Redis } from "@ploydok/db"
import { env } from "../env"
import { childLogger } from "../logger"
import { dispatch } from "../notify"

const log = childLogger("advisories")
const PLATFORM_TARGET_ID = "platform"

export function cveScanEnabled(): boolean {
  return env.PLOYDOK_CVE_SCAN !== "off"
}

export async function capturePlatformManifests(db: Db): Promise<number> {
  if (!cveScanEnabled()) return 0
  const rootDir = findRepoRoot()
  const scanRoots = [
    rootDir,
    path.join(rootDir, "agent"),
    path.join(rootDir, "apps/api"),
    path.join(rootDir, "apps/web"),
    path.join(rootDir, "apps/docs"),
  ].filter((dir) => existsSync(dir))
  const snapshots: ManifestSnapshot[] = []

  for (const scanRoot of scanRoots) {
    const found = await collectManifestDependencies(scanRoot, {
      includeDevDependencies: true,
      maxDepth: 1,
    })
    snapshots.push(
      ...found.map((snapshot) => ({
        ...snapshot,
        path: path.relative(rootDir, path.join(scanRoot, snapshot.path)),
        dependencies: snapshot.dependencies.map((dependency) => ({
          ...dependency,
          manifestPath: path.relative(
            rootDir,
            path.join(scanRoot, dependency.manifestPath)
          ),
        })),
      }))
    )
  }
  return persistManifestSnapshots(db, {
    scope: "platform",
    appId: null,
    targetId: PLATFORM_TARGET_ID,
    snapshots,
  })
}

export async function captureAppManifests(
  db: Db,
  params: { appId: string; checkoutDir: string; rootDir?: string | null }
): Promise<number> {
  if (!cveScanEnabled()) return 0
  const scanRoot = path.join(params.checkoutDir, params.rootDir ?? ".")
  const snapshots = await collectManifestDependencies(scanRoot, {
    includeDevDependencies: false,
    maxDepth: 4,
  })
  return persistManifestSnapshots(db, {
    scope: "app",
    appId: params.appId,
    targetId: params.appId,
    snapshots,
  })
}

export interface RefreshAdvisoriesResult {
  manifests: number
  dependencies: number
  matches: number
  newNotified: number
}

export async function refreshAdvisories(
  db: Db,
  redis?: Redis
): Promise<RefreshAdvisoriesResult> {
  if (!cveScanEnabled()) {
    return { manifests: 0, dependencies: 0, matches: 0, newNotified: 0 }
  }

  const manifestRows = await db.select().from(app_manifests)
  const appProjectById = await loadAppProjectMap(db)
  const depsByManifest = manifestRows.map((manifest) => ({
    manifest,
    dependencies: normalizeDependencies(manifest.dependencies),
  }))
  const allDependencies = depsByManifest.flatMap((item) => item.dependencies)
  if (allDependencies.length === 0) {
    return {
      manifests: manifestRows.length,
      dependencies: 0,
      matches: 0,
      newNotified: 0,
    }
  }

  const osvResults = await queryOsvForDependencies(allDependencies)
  const detailCache = new Map<string, OsvVulnerabilityDetail>()
  const activeMatchIds = new Set<string>()
  let matchCount = 0
  let newNotified = 0

  for (const { manifest, dependencies } of depsByManifest) {
    for (const dependency of dependencies) {
      const result = osvResults.get(dependencyQueryKey(dependency))
      for (const vulnerability of result?.vulns ?? []) {
        const detail =
          detailCache.get(vulnerability.id) ??
          (await fetchOsvVulnerability(vulnerability.id))
        detailCache.set(vulnerability.id, detail)

        const severity = severityFromDetail(detail)
        await upsertAdvisory(db, detail, severity)

        const matchId = stableId([
          manifest.scope,
          manifest.target_id,
          dependency.manifestPath,
          dependency.ecosystem,
          dependency.name,
          dependency.version,
          vulnerability.id,
        ])
        activeMatchIds.add(matchId)
        const projectId =
          manifest.app_id ? appProjectById.get(manifest.app_id) ?? null : null

        const inserted = await upsertMatch(db, {
          id: matchId,
          advisoryId: vulnerability.id,
          scope: manifest.scope,
          appId: manifest.app_id,
          projectId,
          dependency,
          severityLevel: severity.level,
        })
        matchCount += 1

        if (
          inserted &&
          redis &&
          (severity.level === "HIGH" || severity.level === "CRITICAL")
        ) {
          const sent = await notifyMatch(db, redis, {
            matchId,
            advisory: detail,
            dependency,
            appId: manifest.app_id,
            projectId,
            severityLevel: severity.level,
          })
          if (sent) newNotified += 1
        }
      }
    }
  }

  if (activeMatchIds.size > 0) {
    await db
      .update(cve_matches)
      .set({ fixed_at: new Date() })
      .where(
        and(
          isNull(cve_matches.fixed_at),
          notInArray(cve_matches.id, [...activeMatchIds])
        )
      )
  }

  return {
    manifests: manifestRows.length,
    dependencies: allDependencies.length,
    matches: matchCount,
    newNotified,
  }
}

export async function auditCheckout(rootDir: string) {
  return auditApp({ rootDir })
}

async function persistManifestSnapshots(
  db: Db,
  params: {
    scope: "platform" | "app"
    appId: string | null
    targetId: string
    snapshots: ManifestSnapshot[]
  }
): Promise<number> {
  let count = 0
  for (const snapshot of params.snapshots) {
    const deps = snapshot.dependencies
    if (deps.length === 0) continue
    const hash = stableId([snapshot.path, JSON.stringify(deps)])
    const id = stableId([params.scope, params.targetId, snapshot.path, hash])
    await db
      .insert(app_manifests)
      .values({
        id,
        scope: params.scope,
        app_id: params.appId,
        target_id: params.targetId,
        ecosystem: deps[0]?.ecosystem ?? "unknown",
        manifest_path: snapshot.path,
        content_hash: hash,
        dependencies: deps,
        captured_at: new Date(),
      })
      .onConflictDoNothing()
    count += 1
  }
  return count
}

function normalizeDependencies(value: unknown): FoundDependency[] {
  if (!Array.isArray(value)) return []
  return value.filter(isFoundDependency)
}

function isFoundDependency(value: unknown): value is FoundDependency {
  if (!value || typeof value !== "object") return false
  const item = value as Partial<FoundDependency>
  return (
    typeof item.ecosystem === "string" &&
    typeof item.name === "string" &&
    typeof item.version === "string" &&
    typeof item.manifestPath === "string" &&
    typeof item.manifestKind === "string" &&
    typeof item.dev === "boolean"
  )
}

function stableId(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex")
}

function findRepoRoot(): string {
  let current = process.cwd()
  for (let i = 0; i < 6; i++) {
    const pkg = path.join(current, "package.json")
    if (existsSync(pkg)) {
      try {
        const parsed = JSON.parse(readFileSync(pkg, "utf8"))
        if (Array.isArray(parsed.workspaces)) return current
      } catch {
        // continue walking
      }
    }
    const next = path.dirname(current)
    if (next === current) break
    current = next
  }
  return path.resolve(process.cwd(), "../..")
}

interface SeverityInfo {
  level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN"
  type: string | null
  score: string | null
}

function severityFromDetail(detail: OsvVulnerabilityDetail): SeverityInfo {
  const first = detail.severity?.[0]
  if (!first) return { level: "UNKNOWN", type: null, score: null }
  const numeric = Number(first.score.match(/(?:^|:)(\d+(?:\.\d+)?)(?:\/|$)/)?.[1])
  if (Number.isFinite(numeric)) {
    if (numeric >= 9) return { level: "CRITICAL", type: first.type, score: first.score }
    if (numeric >= 7) return { level: "HIGH", type: first.type, score: first.score }
    if (numeric >= 4) return { level: "MEDIUM", type: first.type, score: first.score }
    if (numeric > 0) return { level: "LOW", type: first.type, score: first.score }
  }
  return { level: "UNKNOWN", type: first.type, score: first.score }
}

async function upsertAdvisory(
  db: Db,
  detail: OsvVulnerabilityDetail,
  severity: SeverityInfo
): Promise<void> {
  await db
    .insert(cve_advisories)
    .values({
      id: detail.id,
      summary: detail.summary ?? null,
      details: detail.details ?? null,
      aliases: detail.aliases ?? [],
      severity_level: severity.level,
      severity_type: severity.type,
      severity_score: severity.score,
      references: detail.references ?? [],
      raw: detail,
      published_at: detail.published ? new Date(detail.published) : null,
      modified_at: detail.modified ? new Date(detail.modified) : null,
      withdrawn_at: detail.withdrawn ? new Date(detail.withdrawn) : null,
      updated_at: new Date(),
    })
    .onConflictDoUpdate({
      target: cve_advisories.id,
      set: {
        summary: detail.summary ?? null,
        details: detail.details ?? null,
        aliases: detail.aliases ?? [],
        severity_level: severity.level,
        severity_type: severity.type,
        severity_score: severity.score,
        references: detail.references ?? [],
        raw: detail,
        published_at: detail.published ? new Date(detail.published) : null,
        modified_at: detail.modified ? new Date(detail.modified) : null,
        withdrawn_at: detail.withdrawn ? new Date(detail.withdrawn) : null,
        updated_at: new Date(),
      },
    })
}

async function upsertMatch(
  db: Db,
  params: {
    id: string
    advisoryId: string
    scope: "platform" | "app"
    appId: string | null
    projectId: string | null
    dependency: FoundDependency
    severityLevel: SeverityInfo["level"]
  }
): Promise<boolean> {
  const before = await db
    .select({ id: cve_matches.id })
    .from(cve_matches)
    .where(eq(cve_matches.id, params.id))
    .limit(1)
  await db
    .insert(cve_matches)
    .values({
      id: params.id,
      advisory_id: params.advisoryId,
      scope: params.scope,
      app_id: params.appId,
      project_id: params.projectId,
      ecosystem: params.dependency.ecosystem,
      package_name: params.dependency.name,
      current_version: params.dependency.version,
      manifest_path: params.dependency.manifestPath,
      severity_level: params.severityLevel,
      first_seen_at: new Date(),
      last_seen_at: new Date(),
      fixed_at: null,
    })
    .onConflictDoUpdate({
      target: cve_matches.id,
      set: {
        severity_level: params.severityLevel,
        last_seen_at: new Date(),
        fixed_at: null,
      },
    })
  return before.length === 0
}

async function loadAppProjectMap(db: Db): Promise<Map<string, string>> {
  const rows = await db.select({ id: apps.id, project_id: apps.project_id }).from(apps)
  return new Map(rows.map((row) => [row.id, row.project_id]))
}

async function notifyMatch(
  db: Db,
  redis: Redis,
  params: {
    matchId: string
    advisory: OsvVulnerabilityDetail
    dependency: FoundDependency
    appId: string | null
    projectId: string | null
    severityLevel: string
  }
): Promise<boolean> {
  const dedupKey = `cve:notify:${params.matchId}`
  const first = await redis.set(dedupKey, "1", "EX", 7 * 24 * 3600, "NX")
  if (first === null) return false

  if (params.appId) {
    const [app] = await db
      .select({
        id: apps.id,
        name: apps.name,
        domain: apps.domain,
        project_id: apps.project_id,
        owner_id: projects.owner_id,
      })
      .from(apps)
      .innerJoin(projects, eq(apps.project_id, projects.id))
      .where(eq(apps.id, params.appId))
      .limit(1)
    if (app) {
      await dispatchCve(db, redis, params, {
        userId: app.owner_id,
        projectId: app.project_id,
        appId: app.id,
        appName: app.name,
        appDomain: app.domain,
      })
    }
  } else {
    const owners = await db
      .select({ user_id: memberships.user_id })
      .from(memberships)
      .where(eq(memberships.role, "owner"))
      .groupBy(memberships.user_id)
    for (const owner of owners) {
      await dispatchCve(db, redis, params, {
        userId: owner.user_id,
        projectId: null,
        appId: "platform",
        appName: "Ploydok platform",
        appDomain: null,
      })
    }
  }

  await db
    .update(cve_matches)
    .set({ notified_at: new Date() })
    .where(eq(cve_matches.id, params.matchId))
  return true
}

async function dispatchCve(
  db: Db,
  redis: Redis,
  params: {
    advisory: OsvVulnerabilityDetail
    dependency: FoundDependency
    severityLevel: string
  },
  scope: {
    userId: string
    projectId: string | null
    appId: string
    appName: string
    appDomain: string | null
  }
): Promise<void> {
  await dispatch(
    db,
    redis,
    "cve.detected",
    {
      appId: scope.appId,
      appName: scope.appName,
      appDomain: scope.appDomain,
      advisoryId: params.advisory.id,
      advisorySummary: params.advisory.summary ?? null,
      advisorySeverity: params.severityLevel,
      packageName: params.dependency.name,
      currentVersion: params.dependency.version,
      advisoryUrl: `https://osv.dev/vulnerability/${params.advisory.id}`,
    },
    { userId: scope.userId, projectId: scope.projectId }
  )
}
