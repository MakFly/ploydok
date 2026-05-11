// SPDX-License-Identifier: AGPL-3.0-only
import fs from "node:fs"
import path from "node:path"
import { eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { z } from "zod"
import { apps, builds, projects, system_jobs } from "@ploydok/db"
import { ALL_PROBE_KEYS, classifyStack } from "@ploydok/shared"
import type { StackClassification } from "@ploydok/shared"
import { updateBuildStatus, getAppForUser } from "@ploydok/db/queries"
import { claimQueuedRow } from "../queue-claim"
import { auditUnauthorized, auditClaimed } from "../queue-audit"
import { enqueueWithDbRow } from "../queue-enqueue"
import { cleanupQueue, gcQueue, logArchiveQueue } from "../queues"
import type { Db } from "@ploydok/db"
import { getRegistryCredential } from "@ploydok/db/queries"
import { env } from "../../env"
import { decryptField } from "../../github/app-credentials"
import { GitHubProvider } from "../../github/client"
import { GitHubCache } from "../../github/cache"
import {
  getInstallationToken,
  listAppInstallations,
} from "../../github/installation-tokens"
import { cloneRepo } from "../git"
import { detectBuildMethod } from "../detect"
import { detectDockerfilePort } from "../detect-port"
import { buildImage } from "../buildkit"
import { logBus } from "../log-bus"
import { nixpacksBuild } from "../nixpacks"
import { diskGuard, gcKeepLast, tagManifest } from "../registry"
import { workerLog } from "../logger"
import { eventBus } from "../event-bus"
import { runBlueGreen } from "../runner"
import { runSwarmDeploy } from "../swarm-runner"
import {
  dispatchStaticDeploy,
  gcOldShas,
  caddyStaticRootForApp,
} from "./build-static"
import { imageRepoForApp } from "../../services/runtime-containers"
import { classifyAgentError, FatalDeployError } from "../errors"
import { createRedis } from "@ploydok/db"
import { postCommitStatusForApp } from "../../providers/commit-status"
import { dispatch } from "../../notify/index"
import {
  buildEnvForDeploy,
  buildEnvPairForDeploy,
} from "../../secrets/resolver"
import { runPreDeployHook, runPostDeployHook } from "../hooks"
import { getSharedAgent, getSharedCaddy } from "../../debug/singletons"
import { ensureFrameworkEnvVars } from "../../services/framework-env"
import { purgeCloudflareForApp } from "../../cloudflare/purge"
import { captureAppManifests } from "../../advisories/service"

// Shared Redis client for commit status dedup (singleton per worker process).
const redis = createRedis(env.REDIS_URL)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of the `deploy.requested` job payload. */
const DeployPayloadSchema = z.object({
  buildId: z.string().optional(),
  appId: z.string().optional(),
  commitSha: z.string().nullish(),
  commitMessage: z.string().nullish(),
  kind: z.enum(["tag"]).optional(),
  tag: z.string().optional(),
})

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface AppForDeploy {
  id: string
  project_id: string
  name: string
  slug: string
  status: string
  git_provider: string | null
  repo_full_name: string | null
  branch: string | null
  github_installation_id: string | null
  root_dir: string | null
  dockerfile_path: string | null
  nixpacks_config_path: string | null
  node_version: string | null
  install_command: string | null
  build_command: string | null
  start_command: string | null
  build_method: string | null
  static_output_dir: string | null
  static_spa_fallback: boolean | null
  cdn_mode: "off" | "internal" | "external"
  cdn_cache_ttl_s: number | null
  cdn_cache_paths: string[] | null
  cdn_compression: boolean | null
  cdn_image_optim: boolean | null
  cdn_headers: string | null
  cdn_external_provider: string | null
  runtime_port: number | null
  runtime_mode: "docker" | "swarm"
  swarm_service_name: string | null
  replicas: number
  restart_policy: string | null
  domain: string | null
  keep_per_repo: number | null
  image_ref: string | null
  registry_credential_id: string | null
  owner_id: string
  post_commit_status: boolean
  hooks_pre_deploy: string | null
  hooks_post_deploy: string | null
  hooks_timeout_s: number | null
}

import { isSymfonyFlexWorkspace } from "./symfony-detect"

interface DeployLog {
  info(bindings: Record<string, unknown>, message: string): void
  warn(bindings: Record<string, unknown>, message: string): void
}

function removeLocalImageAfterPush(imageRef: string, log: DeployLog): void {
  void (async () => {
    const proc = Bun.spawn(["docker", "rmi", imageRef], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    if (exitCode === 0) {
      log.info({ imageRef }, "local image removed after push")
      return
    }

    log.warn(
      { imageRef, exitCode, stdout: stdout.trim(), stderr: stderr.trim() },
      "local image removal after push failed"
    )
  })().catch((err) => {
    log.warn({ err, imageRef }, "local image removal after push failed")
  })
}

/**
 * Fetch the app row + project owner_id needed for a deploy.
 * Throws if the app doesn't exist.
 */
async function getAppForDeploy(db: Db, appId: string): Promise<AppForDeploy> {
  const rows = await db
    .select({
      id: apps.id,
      project_id: apps.project_id,
      name: apps.name,
      slug: apps.slug,
      status: apps.status,
      git_provider: apps.git_provider,
      repo_full_name: apps.repo_full_name,
      branch: apps.branch,
      github_installation_id: apps.github_installation_id,
      root_dir: apps.root_dir,
      dockerfile_path: apps.dockerfile_path,
      nixpacks_config_path: apps.nixpacks_config_path,
      node_version: apps.node_version,
      install_command: apps.install_command,
      build_command: apps.build_command,
      start_command: apps.start_command,
      build_method: apps.build_method,
      static_output_dir: apps.static_output_dir,
      static_spa_fallback: apps.static_spa_fallback,
      cdn_mode: apps.cdn_mode,
      cdn_cache_ttl_s: apps.cdn_cache_ttl_s,
      cdn_cache_paths: apps.cdn_cache_paths,
      cdn_compression: apps.cdn_compression,
      cdn_image_optim: apps.cdn_image_optim,
      cdn_headers: apps.cdn_headers,
      cdn_external_provider: apps.cdn_external_provider,
      runtime_port: apps.runtime_port,
      runtime_mode: apps.runtime_mode,
      swarm_service_name: apps.swarm_service_name,
      replicas: apps.replicas,
      restart_policy: apps.restart_policy,
      domain: apps.domain,
      keep_per_repo: apps.keep_per_repo,
      image_ref: apps.image_ref,
      registry_credential_id: apps.registry_credential_id,
      owner_id: projects.owner_id,
      post_commit_status: apps.post_commit_status,
      hooks_pre_deploy: apps.hooks_pre_deploy,
      hooks_post_deploy: apps.hooks_post_deploy,
      hooks_timeout_s: apps.hooks_timeout_s,
    })
    .from(apps)
    .innerJoin(projects, eq(apps.project_id, projects.id))
    .where(eq(apps.id, appId))
    .limit(1)

  const row = rows[0]
  if (!row) throw new Error(`App not found: ${appId}`)
  return row
}

async function classifyWorkspaceStack(params: {
  workspacePath: string
  rootDir: string | null
}): Promise<StackClassification> {
  const root = path.join(params.workspacePath, params.rootDir ?? ".")
  const probes: Partial<Record<(typeof ALL_PROBE_KEYS)[number], boolean>> = {}
  await Promise.all(
    ALL_PROBE_KEYS.map(async (key) => {
      try {
        await fs.promises.stat(path.join(root, key))
        probes[key] = true
      } catch {
        probes[key] = false
      }
    })
  )
  const base = classifyStack(probes)
  if (base.stack !== "php" && base.stack !== "compose") return base
  if (!(await isSymfonyFlexWorkspace(root))) return base
  return {
    ...base,
    stack: "symfony",
    framework: "Symfony",
    confidence: "high",
    suggestedEnvVars: {
      NIXPACKS_PHP_ROOT_DIR: "/app/public",
      NIXPACKS_PHP_FALLBACK_PATH: "/index.php",
      NIXPACKS_INSTALL_CMD:
        "mkdir -p /var/log/nginx /var/cache/nginx && COMPOSER_ALLOW_SUPERUSER=1 composer install --no-interaction --no-progress --prefer-dist --ignore-platform-reqs --optimize-autoloader",
    },
  }
}

function defaultRuntimePortForStack(
  method: "docker" | "nixpacks" | "railpack" | "static",
  classification: StackClassification
): number | null {
  if (method === "static") return null
  if (
    (method === "nixpacks" || method === "railpack") &&
    (classification.stack === "laravel" ||
      classification.stack === "symfony" ||
      classification.stack === "php")
  ) {
    return 80
  }
  return null
}

/**
 * Resolve a GitHub installation access token for the given app.
 *
 * Preference order:
 *  1. `app.github_installation_id` (set explicitly when the app was created).
 *  2. Fallback: scan `listAppInstallations()` and match by repo owner login.
 *     This keeps legacy apps deployable as long as the App is installed on
 *     the same account that owns the repo.
 *
 * Throws a descriptive error if no installation grants access to the repo.
 */
/**
 * Load + decrypt the registry credential attached to an image-source app.
 * Returns null when the app has no credential (anonymous pull).
 */
async function loadRegistryAuthForApp(
  db: Db,
  app: AppForDeploy
): Promise<{ username: string; password: string } | null> {
  if (!app.registry_credential_id) return null
  const row = await getRegistryCredential(
    db,
    app.owner_id,
    app.registry_credential_id
  )
  if (!row) return null
  const password = await decryptField(
    row.password_enc as Buffer,
    row.password_nonce as Buffer
  )
  return { username: row.username, password }
}

async function resolveInstallationTokenForApp(
  app: AppForDeploy
): Promise<{ installationId: string; token: string }> {
  if (!app.repo_full_name) {
    throw new Error(`App ${app.id} has no repo_full_name`)
  }

  if (app.github_installation_id) {
    const token = await getInstallationToken(app.github_installation_id)
    return { installationId: app.github_installation_id, token }
  }

  const ownerLogin = app.repo_full_name.split("/")[0]?.toLowerCase() ?? ""
  const installations = await listAppInstallations()
  const match = installations.find(
    (i) => i.accountLogin.toLowerCase() === ownerLogin
  )
  if (!match) {
    throw new Error(
      `No GitHub App installation grants access to ${app.repo_full_name}. ` +
        `Install the Ploydok GitHub App on ${ownerLogin} (or another account ` +
        `with read access) and set apps.github_installation_id on this app.`
    )
  }
  const installationId = String(match.id)
  const token = await getInstallationToken(installationId)
  return { installationId, token }
}

// ---------------------------------------------------------------------------
// Public handler
// ---------------------------------------------------------------------------

/**
 * Handle a `deploy.requested` job.
 *
 * Orchestration (M2.3 scope):
 *  1. Clone the repo (shallow).
 *  2. Detect build method (Dockerfile vs. Nixpacks).
 *  3. Build with Nixpacks (Nixpacks path only — Docker path is TODO M3.1).
 *  4. TODO M3.3: blue-green runner.
 *  5. Mark build succeeded.
 *
 * On any error: mark build `failed`, re-throw so the caller can mark the job
 * failed and handle retry logic.
 *
 * Workspace cleanup is enqueued as a `cleanup.build` job so it runs
 * asynchronously after this handler returns.
 */
export async function handleDeploy(
  db: Db,
  job: { id: string; payload: string; attempts: number; max_attempts: number }
): Promise<void> {
  const payload = DeployPayloadSchema.parse(JSON.parse(job.payload))

  let appId: string
  let buildId: string

  // Claim the build row from the DB queue (new Wave 2 pattern).
  // Backwards-compat: if buildId is missing but appId is present (legacy job), log + drop.
  let claimed: typeof builds.$inferSelect | null = null
  if (payload.buildId) {
    buildId = payload.buildId
    claimed = await claimQueuedRow<typeof builds.$inferSelect>({
      db,
      table: builds,
      id: buildId,
    })

    if (!claimed) {
      auditUnauthorized({
        jobName: "deploy.requested",
        jobId: job.id,
        payload,
        reason: "build row not found or not pending",
      })
      return
    }

    appId = claimed.app_id
    auditClaimed({
      jobName: "deploy.requested",
      jobId: job.id,
      rowId: buildId,
      actor: claimed.requested_by_user_id,
      source: claimed.source,
    })
  } else if (payload.appId) {
    auditUnauthorized({
      jobName: "deploy.requested",
      jobId: job.id,
      payload,
      reason: "legacy payload format — drop after queue drain",
    })
    return
  } else {
    throw new FatalDeployError("Payload missing both buildId and appId")
  }

  const log = workerLog.child({ jobId: job.id, appId })

  // Fetch app + owner
  const app = await getAppForDeploy(db, appId)
  // Resolve owner once — reused for all eventBus publishes below.
  const ownerId: string | null = app.owner_id ?? null

  // Phase 1.B: image-source apps skip clone + build. Validate their own shape
  // early, then dispatch to the image deploy path below.
  const isImageSource = app.git_provider === "image"
  if (isImageSource) {
    if (!app.image_ref) {
      throw new FatalDeployError(
        `App ${app.id} has git_provider='image' but no image_ref set`
      )
    }
  } else if (!app.repo_full_name || !app.branch) {
    throw new FatalDeployError(
      `App ${app.id} is missing repo_full_name or branch — cannot deploy`
    )
  }

  // Verify ownership: if requested_by_user_id is set, re-verify the user still has access.
  if (claimed.requested_by_user_id !== null) {
    const hasAccess = await getAppForUser(
      db,
      appId,
      claimed.requested_by_user_id
    )
    if (!hasAccess) {
      await updateBuildStatus(db, buildId, "failed", {
        errorMessage: "user lost access during queue wait",
        finishedAt: new Date(),
      })
      return
    }
  }

  // Normalize app.build_method:
  //   - legacy "docker" aliases to "dockerfile"
  //   - "compose" is not yet implemented — reject early (sprint 3.3).
  //   - "railpack" is supported first-class since Wave 3 (PLAN-build-strategy-v2).
  const rawMethod = app.build_method ?? "auto"
  if (rawMethod === "compose") {
    throw new FatalDeployError(
      `build_method="${rawMethod}" is not yet supported (planned sprint 3.3)`
    )
  }
  const normalizedMethod:
    | "docker"
    | "nixpacks"
    | "railpack"
    | "static"
    | "auto" =
    rawMethod === "docker" || rawMethod === "dockerfile"
      ? "docker"
      : rawMethod === "nixpacks"
        ? "nixpacks"
        : rawMethod === "railpack"
          ? "railpack"
          : rawMethod === "static"
            ? "static"
            : "auto"
  const resolvedBuildMethod =
    normalizedMethod === "nixpacks"
      ? "nixpacks"
      : normalizedMethod === "railpack"
        ? "railpack"
        : normalizedMethod === "static"
          ? "static"
          : "docker"

  // Hydrate build record with build_method, commitSha, commitMessage.
  await db
    .update(builds)
    .set({
      build_method: resolvedBuildMethod,
      ...(payload.commitSha != null && { commit_sha: payload.commitSha }),
      ...(payload.commitMessage != null && {
        commit_message: payload.commitMessage,
      }),
    })
    .where(eq(builds.id, buildId))

  await updateBuildStatus(db, buildId, "running", { startedAt: new Date() })
  await db
    .update(apps)
    .set({ status: "building", updated_at: new Date() })
    .where(eq(apps.id, appId))

  // Notify: build started
  if (ownerId) {
    try {
      eventBus.publish(`user:${ownerId}`, {
        type: "build.started",
        appId: app.id,
        buildId,
        message: "Build démarré",
        data: { status: "building" },
      })
    } catch (pubErr) {
      log.warn(
        { pubErr, buildId },
        "eventBus publish build.started failed (non-fatal)"
      )
    }
  } else {
    log.warn(
      { buildId, appId: app.id },
      "no owner found — skipping build.started publish"
    )
  }

  // Notification dispatch — build.started
  if (ownerId) {
    dispatch(
      db,
      redis,
      "build.started",
      {
        appId: app.id,
        appName: app.name,
        commitSha: payload.commitSha ?? null,
        buildId,
      },
      { userId: ownerId, projectId: app.project_id }
    ).catch((err) =>
      log.warn({ err, buildId }, "dispatch build.started failed (non-fatal)")
    )
  }

  log.info({ buildId }, "deploy started")

  // Commit status — pending (best-effort, non-fatal)
  if (payload.commitSha) {
    postCommitStatusForApp(db, redis, app, {
      sha: payload.commitSha,
      state: "pending",
      description: "Build en cours",
      buildId,
    }).catch((err) =>
      log.warn({ err, buildId }, "postCommitStatus(pending) failed (non-fatal)")
    )
  }

  // Create log file stream for this build.
  const logDir = path.join(env.PLOYDOK_BUILD_DIR, app.id)
  const logPath = path.join(logDir, `${buildId}.log`)
  fs.mkdirSync(logDir, { recursive: true })
  const logStream = fs.createWriteStream(logPath, { flags: "a" })

  /** Shared log sink used from this point forward (file + SSE bus + pino). */
  const onLog = (line: string): void => {
    log.debug({ buildId }, line)
    logBus.publish(`build:${buildId}`, line)
    logStream.write(line + "\n")
  }

  // Persist log_path early so a crash before the finally block still leaves
  // a resolvable pointer — the on-disk file exists from the moment the stream
  // is opened; the download endpoint then serves partial logs even when the
  // worker is killed (SIGKILL, OOM, dev-server restart, …).
  await updateBuildStatus(db, buildId, "running", { logPath })

  // Track final outcome so the finally block can write log_path once.
  let finalStatus: "succeeded" | "succeeded_with_warning" | "failed" =
    "succeeded"
  let finalPatch: {
    finishedAt: Date
    errorMessage?: string
    containerId?: string
    runtimeRef?: string
    postDeployError?: string
  } = { finishedAt: new Date() }
  // Resolved commit sha (updated once clone resolves HEAD, used for commit status)
  let resolvedCommitShaFinal: string | null = payload.commitSha ?? null
  let workspacePathForAudit: string | null = null
  // Commit status state to post on failure: FatalDeployError → failure, unknown → error
  let commitStatusErrorState: "failure" | "error" = "error"
  const deployStartMs = Date.now()

  try {
    // ── Phase 1.B: Docker-image source ──────────────────────────────────────
    //
    // When git_provider === 'image', skip clone + build entirely. The image
    // reference is used directly; runBlueGreen's pre-spawn pullImage handles
    // authentication via the registry credential associated with the app.
    if (isImageSource) {
      const imageRef = app.image_ref!
      const imageLog = (line: string) => {
        log.debug({ buildId }, line)
        logBus.publish(`build:${buildId}`, line)
        logStream.write(line + "\n")
      }
      imageLog(`[deploy] image source: ${imageRef}`)
      await updateBuildStatus(db, buildId, "running", { imageTag: imageRef })

      if (ownerId) {
        try {
          eventBus.publish(`user:${ownerId}`, {
            type: "deploy.status_change",
            appId: app.id,
            buildId,
            message: "Image source prête",
            data: { imageTag: imageRef },
          })
        } catch (pubErr) {
          log.warn(
            { pubErr, buildId },
            "eventBus publish (image source) failed (non-fatal)"
          )
        }
      }

      const registryAuth = await loadRegistryAuthForApp(db, app)
      const secretEnv = await buildEnvForDeploy(db, app.id, "prod", "runtime")

      // Pre-deploy hook (image source path)
      if (app.hooks_pre_deploy) {
        imageLog("[deploy] running pre-deploy hook")
        const hookCtx = {
          db,
          agent: getSharedAgent(),
          appId: app.id,
          projectId: app.project_id,
          imageRef,
          env: secretEnv,
          buildId,
        }
        try {
          await runPreDeployHook(
            hookCtx,
            app.hooks_pre_deploy,
            app.hooks_timeout_s ?? 300
          )
        } catch (hookErr) {
          throw classifyAgentError(hookErr)
        }
      }

      let runtimeRef: string
      let containerId: string | undefined
      try {
        if (app.runtime_mode === "docker") {
          const runOpts: Parameters<typeof runBlueGreen>[0] = {
            appId: app.id,
            imageRef,
            env: secretEnv,
            db,
          }
          if (app.runtime_port !== null) runOpts.runtimePort = app.runtime_port
          if (registryAuth) runOpts.registryAuth = registryAuth
          ;({ containerId } = await runBlueGreen(runOpts))
          runtimeRef = containerId
        } else {
          const result = await runSwarmDeploy({
            appId: app.id,
            imageRef,
            env: secretEnv,
            db,
            ...(registryAuth ? { registryAuth } : {}),
            ...(app.runtime_port !== null ? { runtimePort: app.runtime_port } : {}),
          })
          runtimeRef = result.runtimeRef
        }
      } catch (runErr) {
        throw classifyAgentError(runErr)
      }
      imageLog(`[deploy] runtime live: ${runtimeRef}`)

      // Post-deploy hook (image source path) — non-fatal on failure
      if (app.hooks_post_deploy) {
        imageLog("[deploy] running post-deploy hook")
        const postHookCtx = {
          db,
          agent: getSharedAgent(),
          appId: app.id,
          projectId: app.project_id,
          imageRef,
          env: secretEnv,
          buildId,
        }
        const postResult = await runPostDeployHook(
          postHookCtx,
          app.hooks_post_deploy,
          app.hooks_timeout_s ?? 300
        )
        if (!postResult.ok) {
          imageLog(
            `[deploy] post-deploy hook failed (non-fatal): ${postResult.error ?? "unknown"}`
          )
          finalStatus = "succeeded_with_warning"
          finalPatch = {
            finishedAt: new Date(),
            ...(containerId ? { containerId } : {}),
            runtimeRef,
            ...(postResult.error
              ? { postDeployError: postResult.error.slice(0, 500) }
              : {}),
          }
          log.warn(
            { buildId, err: postResult.error },
            "post-deploy hook failed (succeeded_with_warning)"
          )
        }
      }

      if (finalStatus !== "succeeded_with_warning") {
        finalPatch = {
          finishedAt: new Date(),
          ...(containerId ? { containerId } : {}),
          runtimeRef,
        }
      }

      if (ownerId) {
        try {
          eventBus.publish(`user:${ownerId}`, {
            type: "deploy.status_change",
            appId: app.id,
            buildId,
            message: "Runtime live",
            data: { containerId, runtimeRef, status: "running" },
          })
        } catch (pubErr) {
          log.warn(
            { pubErr, buildId },
            "eventBus publish (image live) failed (non-fatal)"
          )
        }
      }

      if (finalStatus !== "succeeded_with_warning") {
        finalStatus = "succeeded"
      }
      log.info({ buildId, imageRef, finalStatus }, "image deploy completed")
      return
    }

    // Past this point we know the app is a git source with repo+branch
    // (validated above before the isImageSource branch returned).
    const repoFullName = app.repo_full_name!
    const branchName = app.branch!

    // 1. Clone
    const { installationId, token } = await resolveInstallationTokenForApp(app)
    const ghCache = new GitHubCache()
    const ghProvider = new GitHubProvider(ghCache)
    const cloneUrl = ghProvider.cloneUrlWithToken(repoFullName, token)

    log.info({ buildId, installationId }, "cloning repo")
    let cloneResult: Awaited<ReturnType<typeof cloneRepo>>
    try {
      cloneResult = await cloneRepo({
        repoCloneUrl: cloneUrl,
        buildDir: env.PLOYDOK_BUILD_DIR,
        appId: app.id,
        buildId,
        branch: branchName,
      })
    } catch (cloneErr) {
      throw classifyAgentError(cloneErr)
    }
    const { workspacePath, headSha } = cloneResult
    workspacePathForAudit = workspacePath

    // When the deploy was triggered without an explicit commit (manual deploy,
    // initial create), persist the actual HEAD sha so the UI can show it.
    const resolvedCommitSha = payload.commitSha ?? headSha ?? null
    if (resolvedCommitSha && payload.commitSha == null) {
      await updateBuildStatus(db, buildId, "running", {
        commitSha: resolvedCommitSha,
      })
    }
    // Capture for finally block commit status hooks
    resolvedCommitShaFinal = resolvedCommitSha

    // 2. Detect build method.
    const detectedOverride =
      normalizedMethod === "docker" ||
      normalizedMethod === "nixpacks" ||
      normalizedMethod === "railpack" ||
      normalizedMethod === "static"
        ? normalizedMethod
        : "auto"
    const detected = await detectBuildMethod({
      workspacePath,
      override: detectedOverride,
      ...(app.root_dir !== null && { rootDir: app.root_dir }),
      ...(app.dockerfile_path !== null
        ? { dockerfilePath: app.dockerfile_path }
        : {}),
    })
    log.info({ buildId, method: detected.method }, "build method detected")

    // Persist the resolved build_method when detection overrides our initial guess.
    if (detected.method !== resolvedBuildMethod) {
      await updateBuildStatus(db, buildId, "running", {
        buildMethod: detected.method,
      })
    }

    // Auto-detect runtime_port for Docker-path builds when the app didn't
    // declare one. We read the EXPOSE directive of the user's Dockerfile.
    // Persisting here means subsequent deploys skip the probe and go straight
    // to the right port.
    //
    // Falls back to the hardcoded 3000 in runner.ts only when nothing could be
    // detected, which is the only sensible behavior for opaque nixpacks images.
    if (
      detected.method === "docker" &&
      (app.runtime_port === null || app.runtime_port === undefined)
    ) {
      const dockerfileAbsForProbe = path.join(
        workspacePath,
        app.root_dir ?? ".",
        detected.dockerfilePath ?? "Dockerfile"
      )
      const detectedPort = await detectDockerfilePort(dockerfileAbsForProbe)
      if (detectedPort !== null) {
        onLog(
          `[deploy] detected runtime port ${detectedPort} from Dockerfile EXPOSE`
        )
        await db
          .update(apps)
          .set({ runtime_port: detectedPort, updated_at: new Date() })
          .where(eq(apps.id, app.id))
        app.runtime_port = detectedPort
      }
    }

    // Framework env guardrail: creation-time auto-injection is best effort and
    // older apps may predate it. Re-check the cloned source on every deploy and
    // persist missing framework-critical vars before build/runtime env is read.
    const workspaceClassification = await classifyWorkspaceStack({
      workspacePath,
      rootDir: app.root_dir,
    })
    try {
      const { injected } = await ensureFrameworkEnvVars({
        db,
        appId: app.id,
        projectId: app.project_id,
        classification: workspaceClassification,
      })
      if (injected.length > 0) {
        onLog(
          `[deploy] auto-injected framework env vars: ${injected.join(", ")}`
        )
        log.info(
          {
            buildId,
            appId: app.id,
            stack: workspaceClassification.stack,
            injected,
          },
          "auto-injected framework env vars during deploy"
        )
      }
    } catch (autoEnvErr) {
      if (workspaceClassification.stack === "laravel") {
        throw new FatalDeployError(
          `Impossible de préparer les variables Laravel requises: ${
            autoEnvErr instanceof Error ? autoEnvErr.message : "unknown error"
          }`
        )
      }
      log.warn(
        { autoEnvErr, buildId, stack: workspaceClassification.stack },
        "framework env auto-injection failed (non-fatal)"
      )
    }

    if (
      detected.method !== "static" &&
      (app.runtime_port === null || app.runtime_port === undefined)
    ) {
      const inferredRuntimePort = defaultRuntimePortForStack(
        detected.method,
        workspaceClassification
      )
      if (inferredRuntimePort !== null) {
        onLog(
          `[deploy] inferred runtime port ${inferredRuntimePort} for ${workspaceClassification.stack} via ${detected.method}`
        )
        await db
          .update(apps)
          .set({ runtime_port: inferredRuntimePort, updated_at: new Date() })
          .where(eq(apps.id, app.id))
        app.runtime_port = inferredRuntimePort
      }
    }

    // Guard: abort early if registry disk is too full (threshold = 80 %).
    // Under pressure, kick an aggressive sweep (keep 1 per repo) before
    // giving up — most builds will recover instead of failing the deploy.
    await diskGuard(80, async () => {
      const { runAggressiveDiskGuard } = await import("./gc-registry")
      await runAggressiveDiskGuard({
        db,
        thresholdPct: 80,
        keepPerRepoUnderPressure: 1,
      })
    })

    // 3. Build
    // BuildKit runs inside a compose container; from its POV `127.0.0.1:5000` is
    // its own loopback (nothing there). It must reach the registry container
    // via the compose DNS name `registry:5000` (PLOYDOK_REGISTRY_PUSH_URL).
    // Host-side consumers (agent → docker daemon) reach the same registry
    // via the published port at `127.0.0.1:5000` (PLOYDOK_REGISTRY_URL). Both
    // refer to the same manifest in the registry storage (keyed by repo:tag).
    //
    // Docker registry repo names must match [a-z0-9._/-]+; nanoid() app.id
    // contains uppercase, so we lowercase for the repo component only.
    const stripScheme = (u: string) => u.replace(/^https?:\/\//, "")
    const commitSha = resolvedCommitSha ?? buildId
    const pushRegistry = stripScheme(env.PLOYDOK_REGISTRY_PUSH_URL)
    const pullRegistry = stripScheme(env.PLOYDOK_REGISTRY_URL)
    const repo = imageRepoForApp(app.id)
    const pushRef = `${pushRegistry}/${repo}:${commitSha}`
    const imageRef = `${pullRegistry}/${repo}:${commitSha}`

    // onLog is defined earlier in this handler (right after logStream creation)
    // so it can be used by both the image-source path and the git-source path.

    const { build: buildEnvSecrets, runtime: runtimeSecretEnvRaw } =
      await buildEnvPairForDeploy(db, app.id, "prod")

    // Platform-injected metadata vars. Exposed to user apps at BOTH build and
    // runtime (e.g. Next.js SSG reads `process.env.PLOYDOK_BUILD_ID` during
    // `next build` to stamp the rendered HTML; a runtime handler can read
    // the same var). Same convention as Vercel's VERCEL_* or Railway's
    // RAILWAY_* — lets user code surface the deployed version without wiring
    // a custom secret. User secrets win on key conflict (spread after).
    const platformEnv: Record<string, string> = {
      PLOYDOK_APP_ID: app.id,
      PLOYDOK_BUILD_ID: buildId,
      PLOYDOK_COMMIT_SHA: commitSha,
    }
    const buildEnv: Record<string, string> = {
      ...platformEnv,
      ...buildEnvSecrets,
    }
    const runtimeSecretEnv: Record<string, string> = {
      ...platformEnv,
      ...runtimeSecretEnvRaw,
    }

    if (detected.method === "static") {
      onLog("[deploy] static site build selected")
      const staticResult = await dispatchStaticDeploy(
        app.id,
        commitSha,
        app.static_output_dir ?? "dist",
        {
          workspacePath,
          rootDir: app.root_dir,
          installCommand: app.install_command,
          buildCommand: app.build_command,
          env: buildEnv,
          onLog,
        }
      )
      onLog(`[deploy] static files installed: ${staticResult.shaDir}`)

      if (app.domain) {
        await getSharedCaddy().upsertStaticRoute({
          appId: app.id,
          host: app.domain,
          root: caddyStaticRootForApp(app.id),
          spaFallback: app.static_spa_fallback ?? true,
          cdn: app,
        })
        await purgeCloudflareForApp(db, app.id)
        onLog(`[deploy] Caddy static route updated for ${app.domain}`)
      }

      const keep = app.keep_per_repo ?? 3
      if (keep > 0) {
        const deleted = await gcOldShas(app.id, keep)
        if (deleted > 0) onLog(`[deploy] static GC removed ${deleted} build(s)`)
      }

      await db
        .update(apps)
        .set({
          container_id: null,
          status: "serving",
          updated_at: new Date(),
        })
        .where(eq(apps.id, app.id))

      finalPatch = { finishedAt: new Date() }
      finalStatus = "succeeded"

      if (ownerId) {
        try {
          eventBus.publish(`user:${ownerId}`, {
            type: "deploy.status_change",
            appId: app.id,
            buildId,
            message: "Static site live",
            data: { status: "serving" },
          })
        } catch (pubErr) {
          log.warn(
            { pubErr, buildId },
            "eventBus publish deploy.status_change (static live) failed (non-fatal)"
          )
        }
      }

      log.info({ buildId, finalStatus }, "static deploy completed")
      return
    } else if (detected.method === "docker") {
      // BuildKit path (M3.1)
      const contextDir = path.join(workspacePath, app.root_dir ?? ".")
      const dockerfileRel = detected.dockerfilePath ?? "Dockerfile"
      const dockerfileAbs = path.join(contextDir, dockerfileRel)
      const cacheDir = path.join(
        env.PLOYDOK_BUILD_DIR,
        app.id,
        ".buildkit-cache"
      )

      log.info({ buildId, imageRef, pushRef }, "starting BuildKit build")
      let imageDigest: string, durationMs: number
      try {
        ;({ imageDigest, durationMs } = await buildImage({
          contextDir,
          dockerfile: dockerfileAbs,
          imageRef: pushRef,
          cacheDir,
          // Secrets from the secrets table are always sensitive material — pass
          // them ONLY as --secret mounts. Passing them as --build-arg bakes
          // the plaintext into the image history, visible via `docker history`.
          buildSecrets: buildEnv,
          onLog,
        }))
      } catch (buildErr) {
        throw classifyAgentError(buildErr)
      }

      log.info(
        { buildId, imageRef, imageDigest, durationMs },
        "BuildKit build + push done"
      )
      await updateBuildStatus(db, buildId, "running", { imageTag: imageRef })

      // If this is a tag deploy, also push the image under the git tag name.
      if (payload.kind === "tag" && payload.tag) {
        await tagManifest(repo, commitSha, payload.tag).catch((tagErr) => {
          log.warn(
            { tagErr, buildId, tag: payload.tag },
            "tag manifest push failed (non-fatal)"
          )
        })
      }

      // Notify: image pushed (BuildKit path)
      if (ownerId) {
        try {
          eventBus.publish(`user:${ownerId}`, {
            type: "deploy.status_change",
            appId: app.id,
            buildId,
            message: "Image poussée au registry",
            data: { imageTag: imageRef },
          })
        } catch (pubErr) {
          log.warn(
            { pubErr, buildId },
            "eventBus publish deploy.status_change (buildkit) failed (non-fatal)"
          )
        }
      }

      // Post-push GC: keep last 3 images for this app repo.
      gcKeepLast(repo, 3).catch((gcErr) => {
        log.warn({ gcErr, repo }, "post-build GC failed (non-fatal)")
      })
    } else if (detected.method === "railpack") {
      // Railpack path (Wave 3 — iso Dokploy): newer Go-based builder by
      // Railway that uses Caddy instead of nginx for PHP. Same host-side
      // docker daemon semantics as nixpacks (imageRef not pushRef).
      const railpackCache = path.join(
        env.PLOYDOK_BUILD_DIR,
        app.id,
        ".railpack-cache"
      )
      log.info({ buildId, imageRef, pushRef }, "starting railpack build")
      try {
        const { railpackBuild } = await import("../railpack")
        await railpackBuild({
          workspacePath,
          tag: imageRef,
          cacheDir: railpackCache,
          ...(app.root_dir !== null && { rootDir: app.root_dir }),
          ...(Object.keys(buildEnv).length > 0 && { buildEnv }),
          onLog,
        })
      } catch (rpErr) {
        throw classifyAgentError(rpErr)
      }

      // Push to local registry (same pattern as nixpacks path).
      onLog(`[deploy] pushing image to ${imageRef}`)
      const pushProc = Bun.spawn(["docker", "push", imageRef], {
        stdout: "pipe",
        stderr: "pipe",
      })
      const pushStdout = await new Response(pushProc.stdout).text()
      const pushStderr = await new Response(pushProc.stderr).text()
      for (const line of (pushStdout + pushStderr).split("\n")) {
        if (line) onLog(line)
      }
      const pushCode = await pushProc.exited
      if (pushCode !== 0) {
        throw new Error(
          `docker push failed (exit ${pushCode}) for ${imageRef}: ${pushStderr.trim()}`
        )
      }
      removeLocalImageAfterPush(imageRef, log)
      log.info({ buildId, imageRef }, "railpack build + push done")
      await updateBuildStatus(db, buildId, "running", { imageTag: imageRef })

      gcKeepLast(repo, 3).catch((gcErr) => {
        log.warn({ gcErr, repo }, "post-build GC failed (non-fatal)")
      })
    } else {
      // Nixpacks path
      const nixpacksCache = path.join(
        env.PLOYDOK_BUILD_DIR,
        app.id,
        ".nixpacks-cache"
      )
      // Pre-check: run `nixpacks plan` to preview what Nixpacks sees. If no
      // provider matched, fail fast with a precise message instead of
      // letting a multi-minute build crash on an empty plan.
      try {
        const { nixpacksPlan } = await import("../nixpacks")
        const plan = await nixpacksPlan({
          workspacePath,
          ...(app.root_dir !== null && { rootDir: app.root_dir }),
          ...(app.node_version !== null && { nodeVersion: app.node_version }),
          ...(Object.keys(buildEnv).length > 0 && { buildEnv }),
        })
        if (plan) {
          const providers = plan.providers ?? []
          // Canonical "plan is valid" signal = presence of build phases.
          // `providers` is metadata that can legitimately be empty even when
          // Nixpacks produced a full plan (observed: Laravel repos yield
          // `providers:[]` + `variables.IS_LARAVEL=yes` + full phases).
          const phases = plan.phases ?? {}
          const hasPhases = Object.keys(phases).length > 0
          if (!hasPhases && providers.length === 0) {
            throw new FatalDeployError(
              "Nixpacks ne détecte aucun provider dans ce repo — ajoute un Dockerfile, un nixpacks.toml, ou choisis un autre build_method."
            )
          }
          onLog(
            `[deploy] nixpacks plan OK: providers=[${providers.join(",")}] phases=[${Object.keys(phases).join(",")}]`
          )
        }
      } catch (planErr) {
        if (planErr instanceof FatalDeployError) throw planErr
        // Plan check failed for an unknown reason — don't block the build,
        // let the real nixpacks run produce the canonical error.
        log.warn(
          { planErr, buildId },
          "nixpacks plan pre-check failed (non-fatal, proceeding with build)"
        )
      }
      log.info({ buildId, imageRef, pushRef }, "starting nixpacks build")
      try {
        // Unlike buildctl (which runs inside the buildkitd compose container
        // and pushes via the compose DNS name `registry:5000`), `nixpacks
        // build` shells out to the HOST docker daemon. The host resolves the
        // registry at `127.0.0.1:5000` (published port), not `registry:5000`
        // (compose-internal DNS). Tagging with `pushRef` here would create an
        // unreachable name in the local image store — that's why the pull at
        // blue-green fails with 404. Use `imageRef` (host-side addr) so the
        // subsequent `docker push` below lands in the registry.
        await nixpacksBuild({
          workspacePath,
          tag: imageRef,
          cacheKey: app.id,
          cacheDir: nixpacksCache,
          // NOTE: `--incremental-cache-image` is intentionally disabled.
          // On Linux + BuildKit (our setup), nixpacks' incremental-cache
          // injects `host.docker.internal:<port>` curl uploads into the
          // generated Dockerfile. That hostname does not resolve inside
          // our containerized buildkitd (which runs in the `ploydok`
          // bridge network, not host), so every build fails at the cache
          // upload step. BuildKit's own layer cache + `--cache-key`
          // already cover the common reuse cases.
          ...(app.root_dir !== null && { rootDir: app.root_dir }),
          ...(app.nixpacks_config_path !== null && {
            configFile: app.nixpacks_config_path,
          }),
          ...(app.node_version !== null && { nodeVersion: app.node_version }),
          ...(app.install_command !== null && {
            installCmd: app.install_command,
          }),
          ...(app.build_command !== null && { buildCmd: app.build_command }),
          ...(app.start_command !== null && { startCmd: app.start_command }),
          ...(Object.keys(buildEnv).length > 0 && { buildEnv }),
          ...(Object.keys(runtimeSecretEnv).length > 0 && {
            runtimeEnv: runtimeSecretEnv,
          }),
          onLog,
        })
      } catch (nixErr) {
        throw classifyAgentError(nixErr)
      }

      // Push the built image into the registry. `nixpacks build` only tags
      // the image in the local docker daemon — it does NOT push. Without
      // this, the blue-green runner cannot pull `imageRef` and fails with
      // "manifest unknown".
      onLog(`[deploy] pushing image to ${imageRef}`)
      const pushProc = Bun.spawn(["docker", "push", imageRef], {
        stdout: "pipe",
        stderr: "pipe",
      })
      const pushStdout = await new Response(pushProc.stdout).text()
      const pushStderr = await new Response(pushProc.stderr).text()
      for (const line of (pushStdout + pushStderr).split("\n")) {
        if (line) onLog(line)
      }
      const pushCode = await pushProc.exited
      if (pushCode !== 0) {
        throw new Error(
          `docker push failed (exit ${pushCode}) for ${imageRef}: ${pushStderr.trim()}`
        )
      }
      removeLocalImageAfterPush(imageRef, log)

      log.info({ buildId, imageRef }, "nixpacks build + push done")
      await updateBuildStatus(db, buildId, "running", { imageTag: imageRef })

      // If this is a tag deploy, also push the image under the git tag name.
      if (payload.kind === "tag" && payload.tag) {
        await tagManifest(repo, commitSha, payload.tag).catch((tagErr) => {
          log.warn(
            { tagErr, buildId, tag: payload.tag },
            "tag manifest push failed (non-fatal)"
          )
        })
      }

      // Notify: image pushed (nixpacks path)
      if (ownerId) {
        try {
          eventBus.publish(`user:${ownerId}`, {
            type: "deploy.status_change",
            appId: app.id,
            buildId,
            message: "Image poussée au registry",
            data: { imageTag: imageRef },
          })
        } catch (pubErr) {
          log.warn(
            { pubErr, buildId },
            "eventBus publish deploy.status_change (nixpacks) failed (non-fatal)"
          )
        }
      }

      // Post-push GC: keep last 3 images for this app repo.
      gcKeepLast(repo, 3).catch((gcErr) => {
        log.warn({ gcErr, repo }, "post-build GC failed (non-fatal)")
      })
    }

    // 4. Runtime deploy — Swarm by default, legacy Docker blue-green when a
    // row is still pinned to runtime_mode=docker during migration.
    onLog(
      app.runtime_mode === "docker"
        ? "[deploy] starting blue-green runner"
        : "[deploy] starting swarm runner"
    )
    // Pre-deploy hook (git source path)
    if (app.hooks_pre_deploy) {
      onLog("[deploy] running pre-deploy hook")
      const preHookCtx = {
        db,
        agent: getSharedAgent(),
        appId: app.id,
        projectId: app.project_id,
        imageRef,
        env: runtimeSecretEnv,
        buildId,
      }
      try {
        await runPreDeployHook(
          preHookCtx,
          app.hooks_pre_deploy,
          app.hooks_timeout_s ?? 300
        )
      } catch (hookErr) {
        throw classifyAgentError(hookErr)
      }
    }

    let containerId: string | undefined
    let runtimeRef: string
    const unsubscribeRuntimeLogs = logBus.subscribe(
      `runtime:${app.id}`,
      (entry) => onLog(entry.line)
    )
    try {
      if (app.runtime_mode === "docker") {
        const runOpts: Parameters<typeof runBlueGreen>[0] = {
          appId: app.id,
          imageRef,
          env: runtimeSecretEnv,
          db,
        }
        if (app.runtime_port !== null) runOpts.runtimePort = app.runtime_port
        ;({ containerId } = await runBlueGreen(runOpts))
        runtimeRef = containerId
      } else {
        const result = await runSwarmDeploy({
          appId: app.id,
          imageRef,
          env: runtimeSecretEnv,
          db,
          ...(app.runtime_port !== null ? { runtimePort: app.runtime_port } : {}),
        })
        runtimeRef = result.runtimeRef
      }
    } catch (runErr) {
      throw classifyAgentError(runErr)
    } finally {
      unsubscribeRuntimeLogs()
    }
    onLog(`[deploy] runtime live: ${runtimeRef}`)

    // Post-deploy hook (git source path) — non-fatal on failure
    if (app.hooks_post_deploy) {
      onLog("[deploy] running post-deploy hook")
      const postHookCtx = {
        db,
        agent: getSharedAgent(),
        appId: app.id,
        projectId: app.project_id,
        imageRef,
        env: runtimeSecretEnv,
        buildId,
      }
      const postResult = await runPostDeployHook(
        postHookCtx,
        app.hooks_post_deploy,
        app.hooks_timeout_s ?? 300
      )
      if (!postResult.ok) {
        onLog(
          `[deploy] post-deploy hook failed (non-fatal): ${postResult.error ?? "unknown"}`
        )
        finalStatus = "succeeded_with_warning"
        finalPatch = {
          finishedAt: new Date(),
          ...(containerId ? { containerId } : {}),
          runtimeRef,
          ...(postResult.error
            ? { postDeployError: postResult.error.slice(0, 500) }
            : {}),
        }
        log.warn(
          { buildId, err: postResult.error },
          "post-deploy hook failed (succeeded_with_warning)"
        )
      }
    }

    // Persist runtime reference into the build record via finalPatch.
    if (finalStatus !== "succeeded_with_warning") {
      finalPatch = {
        finishedAt: new Date(),
        ...(containerId ? { containerId } : {}),
        runtimeRef,
      }
    }

    // Notify: runtime is live.
    if (ownerId) {
      try {
        eventBus.publish(`user:${ownerId}`, {
          type: "deploy.status_change",
          appId: app.id,
          buildId,
          message: "Runtime live",
          data: { containerId, runtimeRef, status: "running" },
        })
      } catch (pubErr) {
        log.warn(
          { pubErr, buildId },
          "eventBus publish deploy.status_change (container live) failed (non-fatal)"
        )
      }
    }

    // 5. Mark succeeded (log_path + terminal event written in finally)
    // Note: finalStatus may already be "succeeded_with_warning" if post-deploy hook failed
    if (finalStatus !== "succeeded_with_warning") {
      finalStatus = "succeeded"
    }

    log.info({ buildId, finalStatus }, "deploy completed")

    // 6. Best-effort auto-prune: keep registry tidy after every success.
    //    Honours image protection (running container + latest succeeded build
    //    are never deleted). Failures are logged but never propagated — the
    //    deploy itself already succeeded.
    try {
      const { jobId } = await enqueueWithDbRow({
        db,
        queue: gcQueue,
        jobName: "gc.registry.requested",
        insertRow: (tx) =>
          tx
            .insert(system_jobs)
            .values({
              id: nanoid(),
              kind: "gc.registry",
              requested_by_user_id: null,
              source: "auto:deploy",
              options: { appId: app.id, keepPerRepo: 3 },
            })
            .returning()
            .then((r: (typeof system_jobs.$inferSelect)[]) => r[0]!),
        buildPayload: (row) => ({ jobId: row.id }),
      })
      log.debug(
        { jobId, appId: app.id, buildId },
        "post-deploy registry-gc enqueued"
      )
    } catch (gcErr) {
      log.warn(
        { gcErr, appId: app.id, buildId },
        "post-deploy registry-gc enqueue failed (non-fatal)"
      )
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error({ buildId, err }, "deploy failed")

    finalStatus = "failed"
    finalPatch = { finishedAt: new Date(), errorMessage: msg }
    commitStatusErrorState =
      err instanceof FatalDeployError ? "failure" : "error"

    // If a previous deploy had put the app in "running", a failed redeploy
    // must NOT overwrite that — blue-green keeps the old container alive.
    // Otherwise (first deploy, previously stopped/failed, etc.) surface the
    // failure on the app row so the dashboard doesn't stick to "created".
    const fallbackStatus: typeof apps.$inferSelect.status =
      app.status === "running" ? "running" : "failed"

    await db
      .update(apps)
      .set({ status: fallbackStatus, updated_at: new Date() })
      .where(eq(apps.id, app.id))

    throw err
  } finally {
    // Close the log stream and persist log_path in a single updateBuildStatus call.
    await new Promise<void>((resolve) => logStream.end(resolve))
    // If the user cancelled this build mid-flight, the row is already
    // `cancelled`. Don't flip it back to succeeded/failed — respect the
    // cancellation. The side-effects (image pushed, container spawned)
    // may have completed anyway but the UI/audit should reflect the
    // user's intent, not the worker's view.
    const currentStatus = (
      await db
        .select({ status: builds.status })
        .from(builds)
        .where(eq(builds.id, buildId))
        .limit(1)
    )[0]?.status
    const wasCancelled = currentStatus === "cancelled"
    if (wasCancelled) {
      log.info(
        { buildId, finalStatus },
        "build was cancelled mid-flight — skipping final status write"
      )
    } else {
      await updateBuildStatus(db, buildId, finalStatus, {
        ...finalPatch,
        logPath,
        ...(finalPatch.postDeployError !== undefined && {
          postDeployError: finalPatch.postDeployError,
        }),
      })
    }

    // Commit status — success / failure / error (best-effort, non-fatal)
    if (resolvedCommitShaFinal && !wasCancelled) {
      const durationMs = Date.now() - deployStartMs
      const statusState =
        finalStatus === "succeeded" || finalStatus === "succeeded_with_warning"
          ? "success"
          : commitStatusErrorState
      postCommitStatusForApp(db, redis, app, {
        sha: resolvedCommitShaFinal,
        state: statusState,
        buildId,
        durationMs,
      }).catch((err) =>
        log.warn(
          { err, buildId },
          `postCommitStatus(${statusState}) failed (non-fatal)`
        )
      )
    }

    // Publish terminal event AFTER the DB commit so any React Query
    // invalidation triggered by the event fetches the final status.
    if (ownerId && !wasCancelled) {
      const terminal =
        finalStatus === "succeeded"
          ? { type: "build.succeeded" as const, message: "Build réussi" }
          : finalStatus === "succeeded_with_warning"
            ? {
                type: "build.succeeded" as const,
                message: "Build réussi (post-deploy hook en échec)",
              }
            : {
                type: "build.failed" as const,
                message: `Build échoué: ${(finalPatch.errorMessage ?? "").slice(0, 200)}`,
              }
      try {
        eventBus.publish(`user:${ownerId}`, {
          type: terminal.type,
          appId: app.id,
          buildId,
          message: terminal.message,
        })
      } catch (pubErr) {
        log.warn(
          { pubErr, buildId },
          `eventBus publish ${terminal.type} failed (non-fatal)`
        )
      }
    }

    // Notification dispatch — build/deploy outcome
    if (
      !wasCancelled &&
      workspacePathForAudit &&
      (finalStatus === "succeeded" || finalStatus === "succeeded_with_warning")
    ) {
      captureAppManifests(db, {
        appId: app.id,
        checkoutDir: workspacePathForAudit,
        rootDir: app.root_dir,
      }).catch((err) =>
        log.warn(
          { err, appId: app.id, buildId },
          "app manifest capture failed (non-fatal)"
        )
      )
    }

    // Notification dispatch — build/deploy outcome
    if (ownerId && !wasCancelled) {
      const durationMs = Date.now() - deployStartMs
      const notifyEvent =
        finalStatus === "succeeded" || finalStatus === "succeeded_with_warning"
          ? "deploy.succeeded"
          : "deploy.failed"
      dispatch(
        db,
        redis,
        notifyEvent,
        {
          appId: app.id,
          appName: app.name,
          commitSha: resolvedCommitShaFinal,
          buildId,
          durationMs,
          errorMessage: finalPatch.errorMessage?.slice(0, 500) ?? null,
        },
        { userId: ownerId, projectId: app.project_id }
      ).catch((err) =>
        log.warn({ err, buildId }, `dispatch ${notifyEvent} failed (non-fatal)`)
      )
    }

    // Fire-and-forget: enqueue async workspace cleanup via BullMQ.
    cleanupQueue.add("cleanup.build", { appId, buildId }).catch((enqErr) => {
      log.warn({ enqErr, buildId }, "failed to push cleanup.build to BullMQ")
    })

    // Fire-and-forget: enqueue async log archive into DB. jobId is
    // deterministic so a worker retry doesn't enqueue duplicates.
    // BullMQ rejects ":" in custom job IDs, so we use "_" as separator.
    logArchiveQueue
      .add("archive", { buildId }, { jobId: `archive_${buildId}` })
      .catch((enqErr: unknown) => {
        const msg = enqErr instanceof Error ? enqErr.message : String(enqErr)
        log.warn({ err: msg, buildId }, "failed to push logs.archive to BullMQ")
      })
  }
}
