// SPDX-License-Identifier: AGPL-3.0-only
import { readFile } from "node:fs/promises"
import { randomBytes } from "node:crypto"
import { Hono } from "hono"
import { z } from "zod"
import { and, eq, isNotNull } from "drizzle-orm"
import { nanoid } from "nanoid"
import { createDb } from "@ploydok/db"
import {
  projects,
  secrets,
  memberships,
  builds,
  app_delete_jobs,
} from "@ploydok/db"
import { encryptSecret } from "../secrets/crypto"
import {
  BuildMethodSchema,
  GitProviderKindSchema,
  HealthcheckConfigSchema,
  ImagePullPolicySchema,
  RestartPolicySchema,
  classifyStack,
  ALL_PROBE_KEYS,
} from "@ploydok/shared"
import {
  getAppActivity,
  getAppForUser,
  getBuildForApp,
  getBuildLogPath,
  updateBuildStatus,
  insertAuditLog,
  insertApp,
  listAppsForUser,
  listBuildsForApp,
  markAppDeleting,
  rotateAppWebhookSecret,
  uniqueSlug,
  updateApp,
  type AppRow,
} from "@ploydok/db/queries"
import { listDeliveriesByApp, getDeliveryById } from "@ploydok/db/queries"
import {
  replayDelivery,
  ReplayLimitError,
  ReplayPayloadMissingError,
} from "../webhooks/deliveries"
import { env } from "../env"
import { deployQueue, appDeleteQueue } from "../worker/queues"
import { enqueueWithDbRow } from "../worker/queue-enqueue"
import { childLogger } from "../logger"
import type { Db } from "@ploydok/db"
import type { AuthUser } from "../auth/middleware"
import { requireSecondFactor } from "../auth/middleware"
import { requireTotpVerified } from "../auth/second-factor"
import { encryptField, decryptField } from "../github/app-credentials"
import { ghProvider } from "./github"
import { getSharedAgent } from "../debug/singletons"
import { resolveRuntimeContainer } from "../services/runtime-containers"
import {
  reconcileAppStatus,
  reconcileAppStatusList,
} from "../services/app-status-reconciler"
import { dispatch as notifyDispatch } from "../notify/index"
import { createRedis } from "@ploydok/db"
import { ensureDefaultOrganizationForUser } from "../services/organizations"

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const PlanSchema = z.enum(["nano", "small", "medium", "large", "custom"])

// nixpacks_config_path is joined with workspacePath at build time and fed to
// nixpacks --config. An attacker controlling this field could point to any
// readable file on the build host. Require a relative path with no traversal.
const NixpacksConfigPathSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[^/\0][^\0]*$/, "must be a relative path")
  .refine(
    (v) =>
      !v.split("/").some((seg) => seg === "" || seg === "." || seg === ".."),
    { message: "path traversal segments are not allowed" }
  )

// node_version is injected verbatim into the build environment. Restrict it to
// a dotted numeric (optionally prefixed by the letter v) to rule out env
// injection via newlines or equals signs.
const NodeVersionSchema = z
  .string()
  .min(1)
  .max(16)
  .regex(/^v?\d+(\.\d+){0,2}$/, "must look like '20', '20.10', or '20.10.0'")

// Base object schema (no .refine so it stays composable with .omit/.extend).
const CreateAppBodyBase = z.object({
  name: z.string().min(1).max(64),
  organizationId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  gitProvider: GitProviderKindSchema,
  // repoFullName + branch are only required for git sources (github / gitlab).
  repoFullName: z
    .string()
    .regex(/^[^/]+\/[^/]+$/)
    .optional(),
  branch: z.string().min(1).optional(),
  installationId: z.string().regex(/^\d+$/).optional(),
  gitlabProjectId: z.number().int().positive().optional(),
  // Image source (gitProvider === 'image') fields.
  imageRef: z.string().min(1).optional(),
  imagePullPolicy: ImagePullPolicySchema.optional(),
  registryCredentialId: z.string().min(1).optional(),
  trackLatest: z.boolean().optional(),
  // Quotas (Phase 1.C). `custom` disables enforcement.
  plan: PlanSchema.optional(),
  cpuLimit: z.number().positive().optional(),
  memLimitMB: z.number().int().positive().optional(),
  pidsLimit: z.number().int().positive().optional(),
  rootDir: z.string().optional(),
  dockerfilePath: z.string().optional(),
  nixpacksConfigPath: NixpacksConfigPathSchema.optional(),
  nodeVersion: NodeVersionSchema.optional(),
  installCommand: z.string().optional(),
  buildCommand: z.string().optional(),
  startCommand: z.string().optional(),
  watchPaths: z.array(z.string()).optional(),
  buildMethod: BuildMethodSchema.optional(),
  runtimePort: z.number().int().positive().optional(),
  restartPolicy: RestartPolicySchema.optional(),
  healthcheck: HealthcheckConfigSchema.partial().optional(),
  domain: z.string().optional(),
  /** Per-app GC override. null clears the override (falls back to default 3). */
  keepPerRepo: z.number().int().min(0).max(50).nullable().optional(),
})

const CreateAppBody = CreateAppBodyBase

// PATCH accepts the same fields except name and projectId are not updatable here
const PatchAppBody = CreateAppBodyBase.omit({
  name: true,
  organizationId: true,
  projectId: true,
})
  .extend({
    auto_deploy_enabled: z.boolean().optional(),
    post_commit_status: z.boolean().optional(),
    coalesce_pushes: z.boolean().optional(),
    deploy_on_tag: z.boolean().optional(),
    // Deploy hooks (Wave 5)
    hooksPreDeploy: z.string().nullable().optional(),
    hooksPostDeploy: z.string().nullable().optional(),
    hooksTimeoutS: z.number().int().min(10).max(3600).optional(),
    // tag_pattern must be a valid regex when provided
    tag_pattern: z
      .string()
      .nullable()
      .optional()
      .refine(
        (v) => {
          if (v === null || v === undefined) return true
          try {
            new RegExp(v)
            return true
          } catch {
            return false
          }
        },
        { message: "tag_pattern must be a valid regular expression" }
      ),
  })
  .partial()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
}

function getUser(c: { get: (key: string) => unknown }): AuthUser {
  return c.get("user") as AuthUser
}

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

function nullToUndefined<T>(value: T | null): T | undefined {
  return value ?? undefined
}

function buildPublicUrl(domain: string | null): string | null {
  if (!domain) return null
  const port = env.PLOYDOK_PUBLIC_PORT ? `:${env.PLOYDOK_PUBLIC_PORT}` : ""
  return `${env.PLOYDOK_PUBLIC_SCHEME}://${domain}${port}`
}

function serializeApp(row: AppRow) {
  return {
    id: row.id,
    // organizationId and projectId are currently both projections of the same
    // underlying `projects.id` column. The backend models an organization as
    // a project row (is_default=true marks the user's default workspace) so
    // the two names are aliases. Kept for the transitional period where the
    // frontend is moving to org-scoped URLs; once the web never requests
    // projectId we drop that field.
    organizationId: row.project_id,
    projectId: row.project_id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    gitProvider: row.git_provider,
    repoFullName: row.repo_full_name,
    branch: row.branch,
    githubInstallationId: row.github_installation_id,
    rootDir: nullToUndefined(row.root_dir),
    dockerfilePath: nullToUndefined(row.dockerfile_path),
    nixpacksConfigPath: nullToUndefined(row.nixpacks_config_path),
    nodeVersion: nullToUndefined(row.node_version),
    installCommand: nullToUndefined(row.install_command),
    buildCommand: nullToUndefined(row.build_command),
    startCommand: nullToUndefined(row.start_command),
    watchPaths: row.watch_paths
      ? (JSON.parse(row.watch_paths) as string[])
      : undefined,
    buildMethod: row.build_method,
    runtimePort: row.runtime_port,
    restartPolicy: row.restart_policy,
    domain: row.domain,
    publicUrl: buildPublicUrl(row.domain),
    containerId: row.container_id,
    keepPerRepo: nullToUndefined(row.keep_per_repo),
    healthcheck: {
      path: row.healthcheck_path,
      port: row.healthcheck_port,
      intervalS: row.healthcheck_interval_s,
      timeoutS: row.healthcheck_timeout_s,
      retries: row.healthcheck_retries,
      startPeriodS: row.healthcheck_start_period_s,
    },
    // Deploy hooks (Wave 5)
    hooksPreDeploy: row.hooks_pre_deploy ?? null,
    hooksPostDeploy: row.hooks_post_deploy ?? null,
    hooksTimeoutS: row.hooks_timeout_s ?? 300,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : row.updated_at,
  }
}

type AppPartialRow = {
  id: string
  project_id: string
  name: string
  slug: string
  status: string | null
  git_provider: string | null
  repo_full_name: string | null
  branch: string | null
  build_method: string | null
  domain: string | null
  container_id: string | null
  created_at: Date | null
  updated_at: Date | null
}

function serializeAppPartial(row: AppPartialRow) {
  return {
    id: row.id,
    organizationId: row.project_id,
    projectId: row.project_id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    gitProvider: row.git_provider,
    repoFullName: row.repo_full_name,
    branch: nullToUndefined(row.branch),
    buildMethod: nullToUndefined(row.build_method),
    domain: nullToUndefined(row.domain),
    publicUrl: nullToUndefined(buildPublicUrl(row.domain)),
    // Exposed so the dashboard can pin runtime/health to the canonical container
    // and ignore orphan slots left behind by failed deploys (Sprint 7-bis fix).
    containerId: row.container_id,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : row.updated_at,
  }
}

type BuildRow = {
  id: string
  app_id: string
  status: string
  build_method: string | null
  image_tag: string | null
  container_id: string | null
  commit_sha: string | null
  commit_message: string | null
  error_message: string | null
  post_deploy_error: string | null
  started_at: Date | null
  finished_at: Date | null
  created_at: Date | null
}

function serializeBuild(row: BuildRow) {
  return {
    id: row.id,
    appId: row.app_id,
    status: row.status,
    buildMethod: row.build_method,
    imageTag: row.image_tag,
    containerId: row.container_id,
    commitSha: row.commit_sha,
    commitMessage: row.commit_message,
    errorMessage: row.error_message ?? null,
    postDeployError: row.post_deploy_error ?? null,
    startedAt:
      row.started_at instanceof Date
        ? row.started_at.getTime()
        : row.started_at,
    finishedAt:
      row.finished_at instanceof Date
        ? row.finished_at.getTime()
        : row.finished_at,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.getTime()
        : row.created_at,
  }
}

// ---------------------------------------------------------------------------
// Router factory — accepts an injected DB for testability
// ---------------------------------------------------------------------------

export function createAppsRouter(db: Db): Hono {
  const router = new Hono()

  // Second-factor enforcement middleware (must be called after requireAuth).
  // Applied on all state-mutating endpoints except POST /apps (creation).
  const sf = requireSecondFactor(db)

  // -------------------------------------------------------------------------
  // POST /apps — Create a new app
  // -------------------------------------------------------------------------

  router.post("/", async (c) => {
    const user = getUser(c)

    let body: z.infer<typeof CreateAppBody>
    try {
      body = CreateAppBody.parse(await c.req.json())
    } catch (err) {
      return c.json(
        { error: { code: "VALIDATION_ERROR", message: String(err) } },
        400
      )
    }

    // Per-source-type field requirements (Phase 1.A/1.B).
    if (body.gitProvider === "image") {
      if (!body.imageRef) {
        return c.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "imageRef is required for image source",
            },
          },
          400
        )
      }
    } else if (!body.repoFullName || !body.branch) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "repoFullName and branch are required for git sources",
          },
        },
        400
      )
    }

    const now = new Date()

    // 1. Resolve organization/project id.
    let projectId: string
    const requestedOrganizationId = body.organizationId ?? body.projectId
    if (requestedOrganizationId) {
      const projectRows = await db
        .select({ id: projects.id })
        .from(projects)
        .innerJoin(
          memberships,
          and(
            eq(memberships.org_id, projects.id),
            eq(memberships.user_id, user.id),
            eq(memberships.role, "owner"),
            isNotNull(memberships.accepted_at)
          )
        )
        .where(eq(projects.id, requestedOrganizationId))
        .limit(1)

      if (!projectRows[0]) {
        return c.json(
          { error: { code: "NOT_FOUND", message: "Organization not found" } },
          404
        )
      }
      projectId = projectRows[0].id
    } else {
      const organization = await ensureDefaultOrganizationForUser(
        db,
        user.id,
        user.display_name
      )
      projectId = organization.id
    }

    // 2. Generate id + slug (unique within project)
    const id = nanoid()
    const baseSlug = slugify(body.name) || "app"
    const slug = await uniqueSlug(db, projectId, baseSlug)

    // 3. Compute domain if absent
    const domainBase = Bun.env["PLOYDOK_DOMAIN_BASE"] ?? "demo.ploydok.local"
    const domain = body.domain ?? `${slug}.${domainBase}`

    // 4. Build healthcheck fields
    const hc = body.healthcheck ?? {}

    const resolvedRuntimePort: number | null = body.runtimePort ?? null

    // 5. INSERT
    const newApp = await insertApp(db, {
      id,
      project_id: projectId,
      name: body.name,
      slug,
      status: "created",
      created_at: now,
      updated_at: now,
      git_provider: body.gitProvider,
      repo_full_name: body.repoFullName ?? null,
      branch: body.branch ?? null,
      github_installation_id: body.installationId ?? null,
      gitlab_project_id: body.gitlabProjectId ?? null,
      image_ref: body.imageRef ?? null,
      image_pull_policy: body.imagePullPolicy ?? null,
      registry_credential_id: body.registryCredentialId ?? null,
      track_latest: body.trackLatest ?? false,
      plan: body.plan ?? "custom",
      cpu_limit: body.cpuLimit ?? null,
      mem_limit_bytes: body.memLimitMB ? body.memLimitMB * 1024 * 1024 : null,
      pids_limit: body.pidsLimit ?? null,
      root_dir: body.rootDir ?? null,
      dockerfile_path: body.dockerfilePath ?? null,
      nixpacks_config_path: body.nixpacksConfigPath ?? null,
      node_version: body.nodeVersion ?? null,
      install_command: body.installCommand ?? null,
      build_command: body.buildCommand ?? null,
      start_command: body.startCommand ?? null,
      watch_paths: body.watchPaths ? JSON.stringify(body.watchPaths) : null,
      build_method:
        body.buildMethod === "docker"
          ? "dockerfile"
          : (body.buildMethod ?? "auto"),
      runtime_port: resolvedRuntimePort,
      restart_policy: body.restartPolicy ?? "unless-stopped",
      domain,
      healthcheck_path: hc.path ?? "/",
      healthcheck_port: hc.port ?? resolvedRuntimePort ?? null,
      healthcheck_interval_s: hc.intervalS ?? 5,
      healthcheck_timeout_s: hc.timeoutS ?? 3,
      healthcheck_retries: hc.retries ?? 6,
      healthcheck_start_period_s: hc.startPeriodS ?? 0,
    })

    // Auto-inject framework-aware env vars (Nixpacks/Railpack only, git sources only).
    // Runs best-effort — failure must never block app creation.
    const resolvedBuildMethod =
      body.buildMethod === "docker"
        ? "dockerfile"
        : (body.buildMethod ?? "auto")
    const shouldAutoInject =
      body.gitProvider === "github" &&
      body.installationId &&
      body.repoFullName &&
      body.branch &&
      (resolvedBuildMethod === "nixpacks" ||
        resolvedBuildMethod === "railpack" ||
        resolvedBuildMethod === "auto")
    if (shouldAutoInject) {
      try {
        const probeResults: Record<string, boolean> = {}
        await Promise.all(
          ALL_PROBE_KEYS.map(async (key) => {
            try {
              probeResults[key] = await ghProvider.fileExists(
                body.installationId!,
                body.repoFullName!,
                key,
                body.branch!
              )
            } catch {
              probeResults[key] = false
            }
          })
        )
        const classification = classifyStack(probeResults)
        const suggested = classification.suggestedEnvVars
        if (Object.keys(suggested).length > 0) {
          // Write to the `secrets` table (phase=both, scope=shared) because
          // that's what `buildEnvPairForDeploy` reads at deploy time. The
          // legacy `env_vars` table is read by the UI but never by the
          // deploy pipeline. User-provided values already present for the
          // same key+scope+phase are preserved (skip-if-exists).
          const existingRows = await db
            .select({
              key: secrets.key,
              scope: secrets.scope,
              phase: secrets.phase,
            })
            .from(secrets)
            .where(eq(secrets.app_id, id))
          const existingSet = new Set(
            existingRows.map((r) => `${r.key}|${r.scope}|${r.phase}`)
          )
          const injected: string[] = []
          for (const [k, v] of Object.entries(suggested)) {
            const signature = `${k}|shared|both`
            if (existingSet.has(signature)) continue
            const { enc, nonce } = await encryptSecret(v)
            await db.insert(secrets).values({
              id: nanoid(),
              app_id: id,
              project_id: projectId,
              scope: "shared",
              phase: "both",
              key: k,
              value_ciphertext: enc,
              nonce,
              created_at: new Date(),
            })
            injected.push(k)
          }
          childLogger("apps-autoinject").info(
            {
              appId: id,
              stack: classification.stack,
              injected,
              skipped: Object.keys(suggested).filter((k) =>
                existingSet.has(`${k}|shared|both`)
              ),
            },
            "auto-inject env vars for detected framework (user values preserved)"
          )
        }
      } catch (err) {
        childLogger("apps-autoinject").warn(
          { err, appId: id },
          "auto-inject failed (non-fatal)"
        )
      }
    }

    await enqueueWithDbRow({
      db,
      queue: deployQueue,
      jobName: "deploy.requested",
      insertRow: (tx) =>
        tx
          .insert(builds)
          .values({
            id: nanoid(),
            app_id: id,
            requested_by_user_id: user.id,
            source: "api",
          })
          .returning()
          .then((r) => r[0]),
      buildPayload: (row) => ({ buildId: row.id }),
      jobOptions: { attempts: 1 },
    })

    return c.json({ app: serializeApp(newApp) }, 201)
  })

  // -------------------------------------------------------------------------
  // GET /apps — List apps for the authenticated user
  // -------------------------------------------------------------------------

  router.get("/", async (c) => {
    const user = getUser(c)
    const organizationId =
      c.req.query("organizationId") ?? c.req.query("projectId") ?? undefined
    const rows = await listAppsForUser(db, user.id, organizationId)
    const reconciled = await reconcileAppStatusList(db, getSharedAgent(), rows)
    return c.json({ apps: reconciled.map(serializeAppPartial) })
  })

  // -------------------------------------------------------------------------
  // GET /apps/:id — App details + last 10 builds
  // -------------------------------------------------------------------------

  router.get("/:id", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")

    const found = await getAppForUser(db, appId, user.id)
    if (!found) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    const app = await reconcileAppStatus(db, getSharedAgent(), found)
    const appBuilds = await listBuildsForApp(db, appId, 10)

    return c.json({
      app: serializeApp(app),
      builds: appBuilds.map(serializeBuild),
    })
  })

  // -------------------------------------------------------------------------
  // PATCH /apps/:id — Update app config
  // -------------------------------------------------------------------------

  router.patch("/:id", sf, async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")!

    // Verify ownership
    const existing = await getAppForUser(db, appId, user.id)
    if (!existing) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    let body: z.infer<typeof PatchAppBody>
    try {
      body = PatchAppBody.parse(await c.req.json())
    } catch (err) {
      return c.json(
        { error: { code: "VALIDATION_ERROR", message: String(err) } },
        400
      )
    }

    // Build update set — only provided fields
    const patch: Record<string, unknown> = { updated_at: new Date() }
    const restartPolicyChanged =
      body.restartPolicy !== undefined &&
      body.restartPolicy !== existing.restart_policy

    if (body.gitProvider !== undefined) patch.git_provider = body.gitProvider
    if (body.repoFullName !== undefined)
      patch.repo_full_name = body.repoFullName
    if (body.branch !== undefined) patch.branch = body.branch
    if (body.installationId !== undefined)
      patch.github_installation_id = body.installationId
    if (body.rootDir !== undefined) patch.root_dir = body.rootDir
    if (body.dockerfilePath !== undefined)
      patch.dockerfile_path = body.dockerfilePath
    if (body.nixpacksConfigPath !== undefined)
      patch.nixpacks_config_path = body.nixpacksConfigPath
    if (body.nodeVersion !== undefined) patch.node_version = body.nodeVersion
    if (body.installCommand !== undefined)
      patch.install_command = body.installCommand
    if (body.buildCommand !== undefined) patch.build_command = body.buildCommand
    if (body.startCommand !== undefined) patch.start_command = body.startCommand
    if (body.watchPaths !== undefined)
      patch.watch_paths = JSON.stringify(body.watchPaths)
    if (body.buildMethod !== undefined) {
      patch.build_method =
        body.buildMethod === "docker" ? "dockerfile" : body.buildMethod
    }
    if (body.runtimePort !== undefined) patch.runtime_port = body.runtimePort
    if (body.restartPolicy !== undefined)
      patch.restart_policy = body.restartPolicy
    if (body.domain !== undefined) patch.domain = body.domain
    if (body.keepPerRepo !== undefined) patch.keep_per_repo = body.keepPerRepo
    if (body.auto_deploy_enabled !== undefined)
      patch.auto_deploy_enabled = body.auto_deploy_enabled
    if (body.post_commit_status !== undefined)
      patch.post_commit_status = body.post_commit_status
    if (body.coalesce_pushes !== undefined)
      patch.coalesce_pushes = body.coalesce_pushes
    if (body.deploy_on_tag !== undefined)
      patch.deploy_on_tag = body.deploy_on_tag
    if (body.tag_pattern !== undefined) patch.tag_pattern = body.tag_pattern

    // Deploy hooks (Wave 5)
    if ("hooksPreDeploy" in body && body.hooksPreDeploy !== undefined)
      patch.hooks_pre_deploy = body.hooksPreDeploy
    if ("hooksPostDeploy" in body && body.hooksPostDeploy !== undefined)
      patch.hooks_post_deploy = body.hooksPostDeploy
    if ("hooksTimeoutS" in body && body.hooksTimeoutS !== undefined)
      patch.hooks_timeout_s = body.hooksTimeoutS

    if (body.healthcheck !== undefined) {
      const hc = body.healthcheck
      if (hc.path !== undefined) patch.healthcheck_path = hc.path
      if (hc.port !== undefined) patch.healthcheck_port = hc.port
      if (hc.intervalS !== undefined)
        patch.healthcheck_interval_s = hc.intervalS
      if (hc.timeoutS !== undefined) patch.healthcheck_timeout_s = hc.timeoutS
      if (hc.retries !== undefined) patch.healthcheck_retries = hc.retries
      if (hc.startPeriodS !== undefined)
        patch.healthcheck_start_period_s = hc.startPeriodS
    }

    const updated = await updateApp(db, appId, patch)

    // Docker only applies restart policy at container creation time.
    // If a running app changes policy, immediately recreate the runtime so the
    // new policy from the DB becomes effective right away.
    let restartTriggered = false
    if (restartPolicyChanged && existing.status === "running") {
      const { restartApp } = await import("../worker/runner.js")
      // Background restart so the PATCH response (and the toast tied to it)
      // doesn't block on runBlueGreen — the badge transitions via SSE.
      await restartApp(appId, db, user.id, { background: true })
      restartTriggered = true
    }

    return c.json({ app: serializeApp(updated), restartTriggered })
  })

  // -------------------------------------------------------------------------
  // DELETE /apps/:id — Cascade delete (Coolify-style, async via job queue)
  //
  // Marks the app as 'deleting', enqueues an `app.delete.requested` job, and
  // returns 202. The worker performs: stop+rm containers, wipe registry
  // images+blobs, remove Caddy route, rm build artifacts, delete DB row
  // (cascades builds/env_vars/domains via FK).
  //
  // Coolify-style query flags (all default true):
  //   ?deleteImages=false        — keep registry manifests + blobs
  //   ?dockerCleanup=false       — leave the container running
  //   ?deleteBuildArtifacts=false — keep ~/.ploydok-dev/builds/<appId>/
  //   ?deleteCaddyRoutes=false   — leave the Caddy upstream wired
  // -------------------------------------------------------------------------

  const DeleteAppQuery = z.object({
    deleteImages: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === "true")),
    dockerCleanup: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === "true")),
    deleteBuildArtifacts: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === "true")),
    deleteCaddyRoutes: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === "true")),
  })

  router.delete("/:id", sf, async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")!

    const existing = await getAppForUser(db, appId, user.id)
    if (!existing) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    let flags: z.infer<typeof DeleteAppQuery>
    try {
      flags = DeleteAppQuery.parse({
        deleteImages: c.req.query("deleteImages"),
        dockerCleanup: c.req.query("dockerCleanup"),
        deleteBuildArtifacts: c.req.query("deleteBuildArtifacts"),
        deleteCaddyRoutes: c.req.query("deleteCaddyRoutes"),
      })
    } catch (err) {
      return c.json(
        { error: { code: "VALIDATION_ERROR", message: String(err) } },
        400
      )
    }

    await markAppDeleting(db, appId)

    const { jobId } = await enqueueWithDbRow({
      db,
      queue: appDeleteQueue,
      jobName: "app.delete.requested",
      insertRow: (tx) =>
        tx
          .insert(app_delete_jobs)
          .values({
            id: nanoid(),
            app_id: appId,
            requested_by_user_id: user.id,
            source: "api",
            options: {
              deleteImages: flags.deleteImages ?? true,
              dockerCleanup: flags.dockerCleanup ?? true,
              deleteBuildArtifacts: flags.deleteBuildArtifacts ?? true,
              deleteCaddyRoutes: flags.deleteCaddyRoutes ?? true,
            },
          })
          .returning()
          .then((r) => r[0]),
      buildPayload: (row) => ({ jobId: row.id }),
    })

    childLogger("apps-delete").info(
      { appId, jobId, flags },
      "delete cascade enqueued"
    )

    return c.json({ ok: true, jobId, status: "deleting" }, 202)
  })

  // -------------------------------------------------------------------------
  // Stubs for endpoints owned by other milestones
  // -------------------------------------------------------------------------

  router.post("/:id/deploy", sf, async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")!

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    const { jobId } = await enqueueWithDbRow({
      db,
      queue: deployQueue,
      jobName: "deploy.requested",
      insertRow: (tx) =>
        tx
          .insert(builds)
          .values({
            id: nanoid(),
            app_id: appId,
            requested_by_user_id: user.id,
            source: "api",
          })
          .returning()
          .then((r) => r[0]),
      buildPayload: (row) => ({ buildId: row.id }),
      jobOptions: { attempts: 1 },
    })

    return c.json({ ok: true, jobId, buildId: null }, 202)
  })
  // stop / restart / rollback are implemented in the [M3.3 lifecycle] block below.
  router.get("/:id/builds", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    const limit = Math.min(Number(c.req.query("limit") ?? 20), 100)
    const appBuilds = await listBuildsForApp(db, appId, limit)
    return c.json({ builds: appBuilds.map(serializeBuild) })
  })
  router.get("/:id/stats", (c) =>
    c.json({ error: "not_implemented_m3_4" }, 501)
  )

  // GET /apps/:id/activity — historical activity timeline derived from builds.
  // Front-end seeds the SSE-driven feed with this so users see recent builds
  // even when the in-memory event ring buffer is cold (e.g. after API restart).
  router.get("/:id/activity", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    const limit = Math.min(Number(c.req.query("limit") ?? 20), 100)
    const events = await getAppActivity(db, appId, limit)
    return c.json({ events })
  })
  // registry-usage implemented in [M4.2 registry — BEGIN/END] block below.

  // [M3.2 logs — BEGIN]
  // GET /apps/:id/logs?buildId=<buildId>
  // Downloads the archived log file for a build.
  // The file path is stored in builds.log_path (set by the build worker).
  // Returns the raw log as text/plain.
  router.get("/:id/logs", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")
    const buildId = c.req.query("buildId")

    if (!buildId) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "buildId query param is required",
          },
        },
        400
      )
    }

    // Verify app ownership.
    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    // Load build row and verify it belongs to this app.
    const build = await getBuildLogPath(db, buildId, appId)
    if (!build) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Build not found" } },
        404
      )
    }

    if (!build.log_path) {
      return c.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "No archived log file for this build",
          },
        },
        404
      )
    }

    let content: Buffer
    try {
      content = await readFile(build.log_path)
    } catch {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Log file not found on disk" } },
        404
      )
    }

    return new Response(content, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="build-${buildId}.log"`,
      },
    })
  })

  router.get("/:id/runtime-logs", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")
    const tailRaw = Number(c.req.query("tail") ?? 200)
    const tail = Number.isFinite(tailRaw)
      ? Math.max(1, Math.min(Math.floor(tailRaw), 1_000))
      : 200

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    try {
      const agent = getSharedAgent()
      const container = await resolveRuntimeContainer(agent, {
        appId,
        preferredContainerRef: app.container_id,
      })

      if (!container) {
        return c.json({ lines: [], containerFound: false })
      }

      const lines: Array<{
        t: number
        line: string
        stream?: "stdout" | "stderr"
      }> = []
      for await (const line of agent.containerLogs({
        containerId: container.id,
        follow: false,
        sinceUnix: 0,
        tail,
      })) {
        const entry: { t: number; line: string; stream?: "stdout" | "stderr" } =
          {
            t: Date.parse(line.timestamp) || Date.now(),
            line: line.line,
          }
        if (line.stream === "stdout" || line.stream === "stderr") {
          entry.stream = line.stream
        }
        lines.push(entry)
      }

      return c.json({ lines, containerFound: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: { code: "RUNTIME_LOGS_ERROR", message } }, 500)
    }
  })

  // Also replace the former stub for /:id/builds/:buildId/logs with a redirect
  // to the canonical log download endpoint above.
  router.get("/:id/builds/:buildId/logs", (c) => {
    const appId = c.req.param("id") ?? ""
    const buildId = c.req.param("buildId") ?? ""
    return c.redirect(`/apps/${appId}/logs?buildId=${buildId}`, 302)
  })

  // POST /:id/builds/:buildId/cancel — cancel a running build.
  // Marks the build status=cancelled in DB, removes its BullMQ job if
  // still queued. Does NOT abort a build that's mid-BuildKit-push — the
  // worker will finish that phase and its final updateBuildStatus(succeeded)
  // will lose the race with our cancel write (the build row will flip
  // back to succeeded). For mid-flight builds, this is best-effort.
  router.post("/:id/builds/:buildId/cancel", sf, async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")!
    const buildId = c.req.param("buildId")!

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    const build = await getBuildForApp(db, buildId, appId)
    if (!build) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Build not found" } },
        404
      )
    }

    if (
      build.status === "succeeded" ||
      build.status === "succeeded_with_warning" ||
      build.status === "failed" ||
      build.status === "cancelled"
    ) {
      return c.json(
        {
          error: {
            code: "INVALID_STATE",
            message: `Build is already in terminal state: ${build.status}`,
          },
        },
        409
      )
    }

    // Remove queued BullMQ jobs for this app (best-effort).
    try {
      const jobs = await deployQueue.getJobs([
        "waiting",
        "delayed",
        "active",
        "paused",
        "prioritized",
      ])
      for (const j of jobs) {
        const data = j.data as { appId?: string }
        if (data.appId === appId) {
          await j.remove().catch(() => {})
        }
      }
    } catch (err) {
      childLogger("apps-cancel-build").warn(
        { err, appId, buildId },
        "failed to remove BullMQ jobs (non-fatal)"
      )
    }

    await updateBuildStatus(db, buildId, "cancelled", {
      finishedAt: new Date(),
      errorMessage: `Cancelled by user ${user.email ?? user.id}`,
    })

    childLogger("apps-cancel-build").info(
      { appId, buildId, userId: user.id },
      "build cancelled by user"
    )

    return c.json({ ok: true })
  })
  // [M3.2 logs — END]

  // [M3.3 lifecycle — BEGIN]
  // POST /apps/:id/rollback — roll back to the previous succeeded build
  // POST /apps/:id/stop    — stop both containers + remove Caddy route
  // POST /apps/:id/restart — stop + re-deploy from last succeeded build image
  // All routes require auth + ownership.

  const RollbackBody = z.object({
    buildId: z.string().optional(),
  })

  router.post("/:id/rollback", sf, async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")!

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    // Parse optional body — empty body is also valid (legacy behaviour)
    let body: z.infer<typeof RollbackBody> = {}
    try {
      const raw = await c.req.text()
      if (raw.trim()) {
        body = RollbackBody.parse(JSON.parse(raw))
      }
    } catch {
      return c.json(
        {
          error: { code: "VALIDATION_ERROR", message: "Invalid request body" },
        },
        400
      )
    }

    // If an explicit buildId is provided, validate it exists and has status succeeded
    if (body.buildId) {
      const targetBuild = await getBuildForApp(db, body.buildId, appId)
      if (!targetBuild) {
        return c.json(
          {
            error: {
              code: "NOT_FOUND",
              message: "Build not found for this app",
            },
          },
          404
        )
      }
      if (targetBuild.status !== "succeeded") {
        return c.json(
          {
            error: {
              code: "INVALID_BUILD_STATUS",
              message: `Cannot rollback to build with status '${targetBuild.status}' — only succeeded builds are allowed`,
            },
          },
          400
        )
      }
    }

    try {
      const { rollbackApp } = await import("../worker/runner.js")
      await rollbackApp(appId, db, body.buildId, undefined)
      return c.json({ ok: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: { code: "ROLLBACK_FAILED", message } }, 500)
    }
  })

  router.post("/:id/stop", sf, async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")!

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    try {
      const { stopApp } = await import("../worker/runner.js")
      await stopApp(appId, db)
      return c.json({ ok: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: { code: "STOP_FAILED", message } }, 500)
    }
  })

  router.post("/:id/restart", sf, async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")!

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    try {
      const { restartApp } = await import("../worker/runner.js")
      // Await only the prelude (build precheck + DB write to "restarting" +
      // SSE event); stop + redeploy run in the background so the response
      // returns before runBlueGreen's onLive emits the "running" event.
      // Otherwise the front sees the SSE flip status to "running" before the
      // mutation promise resolves, inverting toast/badge ordering.
      await restartApp(appId, db, user.id, { background: true })
      return c.json({ ok: true }, 202)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: { code: "RESTART_FAILED", message } }, 500)
    }
  })
  // [M3.3 lifecycle — END]

  // [M4.2 registry — BEGIN]
  // GET  /apps/:id/registry-usage  — per-app registry stats (requires auth + ownership).
  // POST /apps/:id/registry-gc     — trigger an immediate GC prune for this app (owner only).

  router.get("/:id/registry-usage", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    try {
      const { getRegistryUsageForApp } =
        await import("../worker/handlers/gc-registry.js")
      const usage = await getRegistryUsageForApp(appId, db)
      return c.json(usage)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: { code: "REGISTRY_ERROR", message } }, 500)
    }
  })

  router.post("/:id/registry-gc", sf, async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")!

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    try {
      const { runRegistryGc } =
        await import("../worker/handlers/gc-registry.js")
      const result = await runRegistryGc({ db, appFilter: appId })
      return c.json(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: { code: "GC_FAILED", message } }, 500)
    }
  })
  // [M4.2 registry — END]

  // [Wave-3 webhooks — BEGIN]

  // -------------------------------------------------------------------------
  // GET /apps/:id/webhook-deliveries — list deliveries (cursor pagination)
  // -------------------------------------------------------------------------

  router.get("/:id/webhook-deliveries", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")

    const limitRaw = Math.min(Number(c.req.query("limit") ?? 50), 200)
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 50
    const cursor = c.req.query("cursor")

    const result = await listDeliveriesByApp(db, appId, user.id, limit, cursor)
    if (result === null) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    return c.json(result)
  })

  // -------------------------------------------------------------------------
  // GET /apps/:id/webhook-deliveries/:deliveryId — single delivery detail
  // -------------------------------------------------------------------------

  router.get("/:id/webhook-deliveries/:deliveryId", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")
    const deliveryId = c.req.param("deliveryId")

    const delivery = await getDeliveryById(db, appId, deliveryId, user.id)
    if (delivery === null) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Delivery not found" } },
        404
      )
    }

    return c.json({ delivery })
  })

  // -------------------------------------------------------------------------
  // POST /apps/:id/webhook-secret/rotate — rotate per-app webhook secret
  // Protected by requireTotpVerified. Anti-abuse: 409 if rotated < 24h ago.
  // -------------------------------------------------------------------------

  const totpMw = requireTotpVerified(db)

  router.post("/:id/webhook-secret/rotate", totpMw, async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")!

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "App not found" } },
        404
      )
    }

    // Anti-abuse: reject if the existing old secret hasn't expired yet (< 24h since last rotation)
    const now = new Date()
    if (
      app.webhook_secret_old_expires_at &&
      app.webhook_secret_old_expires_at > now
    ) {
      return c.json(
        {
          code: "rotation_cooldown",
          message: "A rotation already happened in the last 24h",
        },
        409
      )
    }

    const newSecretPlain = randomBytes(32).toString("hex")
    const { enc, nonce } = await encryptField(newSecretPlain)
    // Store as nonce (12 bytes) || enc concatenated in a single bytea
    const newSecretBlob = Buffer.concat([nonce, enc])

    // Move current secret → old before overwriting
    await rotateAppWebhookSecret(
      db,
      appId,
      app.webhook_secret ?? null,
      newSecretBlob,
      now
    )

    // Audit
    await insertAuditLog(db, {
      user_id: user.id,
      action: "webhook.secret.rotated",
      target_type: "app",
      target_id: appId,
      created_at: now,
    })

    childLogger("apps-webhook-secret").info(
      { appId, userId: user.id },
      "webhook secret rotated"
    )

    // Notification dispatch — webhook.rotated (best-effort, non-fatal)
    const redisForNotify = createRedis(env.REDIS_URL)
    notifyDispatch(
      db,
      redisForNotify,
      "webhook.rotated",
      {
        appId: app.id,
        appName: app.name,
      },
      { userId: user.id, projectId: app.project_id ?? undefined }
    )
      .catch((err) =>
        childLogger("apps-webhook-secret").warn(
          { err, appId },
          "dispatch webhook.rotated failed (non-fatal)"
        )
      )
      .finally(() => redisForNotify.disconnect())

    // Return plain secret once — caller must copy it to GitHub/GitLab
    return c.json({ secret: newSecretPlain })
  })

  // -------------------------------------------------------------------------
  // POST /apps/:id/webhook-deliveries/:deliveryId/replay — replay a delivery
  // Protected by TOTP. Anti-abuse: max 10 replays per parent delivery → 429.
  // -------------------------------------------------------------------------

  router.post(
    "/:id/webhook-deliveries/:deliveryId/replay",
    totpMw,
    async (c) => {
      const user = getUser(c)
      const appId = c.req.param("id")!
      const deliveryId = c.req.param("deliveryId")!

      // Verify ownership
      const app = await getAppForUser(db, appId, user.id)
      if (!app) {
        return c.json(
          { error: { code: "NOT_FOUND", message: "App not found" } },
          404
        )
      }

      try {
        const newDeliveryId = await replayDelivery(db, deliveryId, appId)

        // Audit
        await insertAuditLog(db, {
          user_id: user.id,
          action: "webhook.replayed",
          target_type: "app",
          target_id: appId,
          metadata: JSON.stringify({
            delivery_id: deliveryId,
            new_delivery_id: newDeliveryId,
          }),
        })

        childLogger("apps-webhook-replay").info(
          { appId, userId: user.id, deliveryId, newDeliveryId },
          "delivery replayed"
        )

        return c.json({ delivery_id: newDeliveryId })
      } catch (err) {
        if (err instanceof ReplayLimitError) {
          return c.json({ code: err.code, message: err.message }, 429)
        }
        if (err instanceof ReplayPayloadMissingError) {
          return c.json({ code: err.code, message: err.message }, 422)
        }
        if (err instanceof Error && err.message === "Delivery not found") {
          return c.json(
            { error: { code: "NOT_FOUND", message: "Delivery not found" } },
            404
          )
        }
        throw err
      }
    }
  )

  // [Wave-3 webhooks — END]

  return router
}

// ---------------------------------------------------------------------------
// Prod singleton — imported by app.ts
// ---------------------------------------------------------------------------

const prodDb = createDb(env.DATABASE_URL)
export const appsRouter = createAppsRouter(prodDb)
