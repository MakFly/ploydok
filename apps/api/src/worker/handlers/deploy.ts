// SPDX-License-Identifier: AGPL-3.0-only
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { apps, projects } from "@ploydok/db";
import {
  insertBuild,
  updateBuildStatus,
} from "@ploydok/db/queries";
import { cleanupQueue } from "../queues";
import type { Db } from "@ploydok/db";
import { getRegistryCredential } from "@ploydok/db/queries";
import { env } from "../../env";
import { decryptField } from "../../github/app-credentials";
import { GitHubProvider } from "../../github/client";
import { GitHubCache } from "../../github/cache";
import {
  getInstallationToken,
  listAppInstallations,
} from "../../github/installation-tokens";
import { cloneRepo } from "../git";
import { detectBuildMethod } from "../detect";
import { buildImage } from "../buildkit";
import { logBus } from "../log-bus";
import { nixpacksBuild } from "../nixpacks";
import { diskGuard, gcKeepLast, tagManifest } from "../registry";
import { workerLog } from "../logger"
import { eventBus } from "../event-bus";
import { runBlueGreen } from "../runner";
import { classifyAgentError, FatalDeployError } from "../errors";
import { createRedis } from "@ploydok/db";
import { postCommitStatusForApp } from "../../providers/commit-status";
import { dispatch } from "../../notify/index";
import { buildEnvForDeploy } from "../../secrets/resolver";
import { runPreDeployHook, runPostDeployHook } from "../hooks";
import { getSharedAgent } from "../../debug/singletons";

// Shared Redis client for commit status dedup (singleton per worker process).
const redis = createRedis(env.REDIS_URL);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of the `deploy.requested` job payload. */
const DeployPayloadSchema = z.object({
  appId: z.string(),
  commitSha: z.string().nullish(),
  commitMessage: z.string().nullish(),
  kind: z.enum(["tag"]).optional(),
  tag: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface AppForDeploy {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  status: string;
  git_provider: string | null;
  repo_full_name: string | null;
  branch: string | null;
  github_installation_id: string | null;
  root_dir: string | null;
  dockerfile_path: string | null;
  nixpacks_config_path: string | null;
  node_version: string | null;
  install_command: string | null;
  build_command: string | null;
  start_command: string | null;
  build_method: string | null;
  runtime_port: number | null;
  restart_policy: string | null;
  image_ref: string | null;
  registry_credential_id: string | null;
  owner_id: string;
  post_commit_status: boolean;
  hooks_pre_deploy: string | null;
  hooks_post_deploy: string | null;
  hooks_timeout_s: number | null;
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
      runtime_port: apps.runtime_port,
      restart_policy: apps.restart_policy,
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
    .limit(1);

  const row = rows[0];
  if (!row) throw new Error(`App not found: ${appId}`);
  return row;
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
  app: AppForDeploy,
): Promise<{ username: string; password: string } | null> {
  if (!app.registry_credential_id) return null;
  const row = await getRegistryCredential(db, app.owner_id, app.registry_credential_id);
  if (!row) return null;
  const password = await decryptField(
    row.password_enc as Buffer,
    row.password_nonce as Buffer,
  );
  return { username: row.username, password };
}

async function resolveInstallationTokenForApp(
  app: AppForDeploy,
): Promise<{ installationId: string; token: string }> {
  if (!app.repo_full_name) {
    throw new Error(`App ${app.id} has no repo_full_name`);
  }

  if (app.github_installation_id) {
    const token = await getInstallationToken(app.github_installation_id);
    return { installationId: app.github_installation_id, token };
  }

  const ownerLogin = app.repo_full_name.split("/")[0]?.toLowerCase() ?? "";
  const installations = await listAppInstallations();
  const match = installations.find(
    (i) => i.accountLogin.toLowerCase() === ownerLogin,
  );
  if (!match) {
    throw new Error(
      `No GitHub App installation grants access to ${app.repo_full_name}. ` +
        `Install the Ploydok GitHub App on ${ownerLogin} (or another account ` +
        `with read access) and set apps.github_installation_id on this app.`,
    );
  }
  const installationId = String(match.id);
  const token = await getInstallationToken(installationId);
  return { installationId, token };
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
  job: { id: string; payload: string; attempts: number; max_attempts: number },
): Promise<void> {
  const payload = DeployPayloadSchema.parse(JSON.parse(job.payload));
  const log = workerLog.child({ jobId: job.id, appId: payload.appId });

  // Fetch app + owner
  const app = await getAppForDeploy(db, payload.appId);
  // Resolve owner once — reused for all eventBus publishes below.
  const ownerId: string | null = app.owner_id ?? null;

  // Phase 1.B: image-source apps skip clone + build. Validate their own shape
  // early, then dispatch to the image deploy path below.
  const isImageSource = app.git_provider === "image";
  if (isImageSource) {
    if (!app.image_ref) {
      throw new FatalDeployError(`App ${app.id} has git_provider='image' but no image_ref set`);
    }
  } else if (!app.repo_full_name || !app.branch) {
    throw new FatalDeployError(`App ${app.id} is missing repo_full_name or branch — cannot deploy`);
  }

  // Create build record.
  // build_method is set to the app-level preference resolved to docker/nixpacks;
  // if the app was created with "auto" or null, we default to "docker" — the
  // actual method used is detected later and stored via updateBuildStatus.
  const resolvedBuildMethod =
    app.build_method === "docker" || app.build_method === "nixpacks"
      ? (app.build_method as "docker" | "nixpacks")
      : "docker"
  const buildId = nanoid();
  await insertBuild(db, {
    id: buildId,
    appId: app.id,
    buildMethod: resolvedBuildMethod,
    ...(payload.commitSha != null && { commitSha: payload.commitSha }),
    ...(payload.commitMessage != null && { commitMessage: payload.commitMessage }),
  });
  await updateBuildStatus(db, buildId, "running", { startedAt: new Date() });
  await db
    .update(apps)
    .set({ status: "building", updated_at: new Date() })
    .where(eq(apps.id, app.id));

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
      log.warn({ pubErr, buildId }, "eventBus publish build.started failed (non-fatal)")
    }
  } else {
    log.warn({ buildId, appId: app.id }, "no owner found — skipping build.started publish")
  }

  // Notification dispatch — build.started
  if (ownerId) {
    dispatch(db, redis, "build.started", {
      appId: app.id,
      appName: app.name,
      commitSha: payload.commitSha ?? null,
      buildId,
    }, { userId: ownerId, projectId: app.project_id }).catch((err) =>
      log.warn({ err, buildId }, "dispatch build.started failed (non-fatal)"),
    )
  }

  log.info({ buildId }, "deploy started");

  // Commit status — pending (best-effort, non-fatal)
  if (payload.commitSha) {
    postCommitStatusForApp(db, redis, app, {
      sha: payload.commitSha,
      state: "pending",
      description: "Build en cours",
      buildId,
    }).catch((err) => log.warn({ err, buildId }, "postCommitStatus(pending) failed (non-fatal)"))
  }

  // Create log file stream for this build.
  const logDir = path.join(env.PLOYDOK_BUILD_DIR, app.id);
  const logPath = path.join(logDir, `${buildId}.log`);
  fs.mkdirSync(logDir, { recursive: true });
  const logStream = fs.createWriteStream(logPath, { flags: "a" });

  // Track final outcome so the finally block can write log_path once.
  let finalStatus: "succeeded" | "succeeded_with_warning" | "failed" = "succeeded";
  let finalPatch: { finishedAt: Date; errorMessage?: string; containerId?: string; postDeployError?: string } = { finishedAt: new Date() };
  // Resolved commit sha (updated once clone resolves HEAD, used for commit status)
  let resolvedCommitShaFinal: string | null = payload.commitSha ?? null;
  // Commit status state to post on failure: FatalDeployError → failure, unknown → error
  let commitStatusErrorState: "failure" | "error" = "error";
  const deployStartMs = Date.now();

  try {
    // ── Phase 1.B: Docker-image source ──────────────────────────────────────
    //
    // When git_provider === 'image', skip clone + build entirely. The image
    // reference is used directly; runBlueGreen's pre-spawn pullImage handles
    // authentication via the registry credential associated with the app.
    if (isImageSource) {
      const imageRef = app.image_ref!;
      const imageLog = (line: string) => {
        log.debug({ buildId }, line);
        logBus.publish(`build:${buildId}`, line);
        logStream.write(line + "\n");
      };
      imageLog(`[deploy] image source: ${imageRef}`);
      await updateBuildStatus(db, buildId, "running", { imageTag: imageRef });

      if (ownerId) {
        try {
          eventBus.publish(`user:${ownerId}`, {
            type: "deploy.status_change",
            appId: app.id,
            buildId,
            message: "Image source prête",
            data: { imageTag: imageRef },
          });
        } catch (pubErr) {
          log.warn({ pubErr, buildId }, "eventBus publish (image source) failed (non-fatal)");
        }
      }

      const registryAuth = await loadRegistryAuthForApp(db, app);
      const secretEnv = await buildEnvForDeploy(db, app.id, "prod", "runtime");

      // Pre-deploy hook (image source path)
      if (app.hooks_pre_deploy) {
        imageLog("[deploy] running pre-deploy hook");
        const hookCtx = {
          db,
          agent: getSharedAgent(),
          appId: app.id,
          projectId: app.project_id,
          imageRef,
          env: secretEnv,
          buildId,
        };
        try {
          await runPreDeployHook(hookCtx, app.hooks_pre_deploy, app.hooks_timeout_s ?? 300);
        } catch (hookErr) {
          throw classifyAgentError(hookErr);
        }
      }

      const runOpts: Parameters<typeof runBlueGreen>[0] = {
        appId: app.id,
        imageRef,
        env: secretEnv,
        db,
      };
      if (app.runtime_port !== null) runOpts.runtimePort = app.runtime_port;
      if (registryAuth) runOpts.registryAuth = registryAuth;
      let containerId: string;
      try {
        ({ containerId } = await runBlueGreen(runOpts));
      } catch (runErr) {
        throw classifyAgentError(runErr);
      }
      imageLog(`[deploy] container live: ${containerId}`);

      // Post-deploy hook (image source path) — non-fatal on failure
      if (app.hooks_post_deploy) {
        imageLog("[deploy] running post-deploy hook");
        const postHookCtx = {
          db,
          agent: getSharedAgent(),
          appId: app.id,
          projectId: app.project_id,
          imageRef,
          env: secretEnv,
          buildId,
        };
        const postResult = await runPostDeployHook(
          postHookCtx,
          app.hooks_post_deploy,
          app.hooks_timeout_s ?? 300,
        );
        if (!postResult.ok) {
          imageLog(`[deploy] post-deploy hook failed (non-fatal): ${postResult.error ?? "unknown"}`);
          finalStatus = "succeeded_with_warning";
          finalPatch = { finishedAt: new Date(), containerId, ...(postResult.error ? { postDeployError: postResult.error.slice(0, 500) } : {}) };
          log.warn({ buildId, err: postResult.error }, "post-deploy hook failed (succeeded_with_warning)");
        }
      }

      if (finalStatus !== "succeeded_with_warning") {
        finalPatch = { finishedAt: new Date(), containerId };
      }

      if (ownerId) {
        try {
          eventBus.publish(`user:${ownerId}`, {
            type: "deploy.status_change",
            appId: app.id,
            buildId,
            message: "Container live",
            data: { containerId, status: "running" },
          });
        } catch (pubErr) {
          log.warn({ pubErr, buildId }, "eventBus publish (image live) failed (non-fatal)");
        }
      }

      if (finalStatus !== "succeeded_with_warning") {
        finalStatus = "succeeded";
      }
      log.info({ buildId, imageRef, finalStatus }, "image deploy completed");
      return;
    }

    // Past this point we know the app is a git source with repo+branch
    // (validated above before the isImageSource branch returned).
    const repoFullName = app.repo_full_name!;
    const branchName = app.branch!;

    // 1. Clone
    const { installationId, token } = await resolveInstallationTokenForApp(app);
    const ghCache = new GitHubCache();
    const ghProvider = new GitHubProvider(ghCache);
    const cloneUrl = ghProvider.cloneUrlWithToken(repoFullName, token);

    log.info({ buildId, installationId }, "cloning repo");
    let cloneResult: Awaited<ReturnType<typeof cloneRepo>>;
    try {
      cloneResult = await cloneRepo({
        repoCloneUrl: cloneUrl,
        buildDir: env.PLOYDOK_BUILD_DIR,
        appId: app.id,
        buildId,
        branch: branchName,
      });
    } catch (cloneErr) {
      throw classifyAgentError(cloneErr);
    }
    const { workspacePath, headSha } = cloneResult;

    // When the deploy was triggered without an explicit commit (manual deploy,
    // initial create), persist the actual HEAD sha so the UI can show it.
    const resolvedCommitSha = payload.commitSha ?? headSha ?? null;
    if (resolvedCommitSha && payload.commitSha == null) {
      await updateBuildStatus(db, buildId, "running", { commitSha: resolvedCommitSha });
    }
    // Capture for finally block commit status hooks
    resolvedCommitShaFinal = resolvedCommitSha;

    // 2. Detect build method
    const detected = await detectBuildMethod({
      workspacePath,
      override: (app.build_method ?? "auto") as "docker" | "nixpacks" | "auto",
      ...(app.root_dir !== null && { rootDir: app.root_dir }),
      ...(app.dockerfile_path !== null && { dockerfilePath: app.dockerfile_path }),
    });
    log.info({ buildId, method: detected.method }, "build method detected");

    // Persist the resolved build_method when detection overrides our initial guess.
    if (detected.method !== resolvedBuildMethod) {
      await updateBuildStatus(db, buildId, "running", { buildMethod: detected.method });
    }

    // Guard: abort early if registry disk is too full (threshold = 80 %).
    // Under pressure, kick an aggressive sweep (keep 1 per repo) before
    // giving up — most builds will recover instead of failing the deploy.
    await diskGuard(80, async () => {
      const { runAggressiveDiskGuard } = await import("./gc-registry");
      await runAggressiveDiskGuard({ db, thresholdPct: 80, keepPerRepoUnderPressure: 1 });
    });

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
    const stripScheme = (u: string) => u.replace(/^https?:\/\//, "");
    const commitSha = resolvedCommitSha ?? buildId;
    const pushRegistry = stripScheme(env.PLOYDOK_REGISTRY_PUSH_URL);
    const pullRegistry = stripScheme(env.PLOYDOK_REGISTRY_URL);
    const repo = `app-${app.id.toLowerCase()}`;
    const pushRef = `${pushRegistry}/${repo}:${commitSha}`;
    const imageRef = `${pullRegistry}/${repo}:${commitSha}`;

    /** Publish a log line to the pino logger, the LogBus (M3.2), and the log file. */
    function onLog(line: string) {
      log.debug({ buildId }, line);
      logBus.publish(`build:${buildId}`, line);
      logStream.write(line + "\n");
    }

    const buildEnv = await buildEnvForDeploy(db, app.id, "prod", "build");
    const runtimeSecretEnv = await buildEnvForDeploy(db, app.id, "prod", "runtime");

    if (detected.method === "docker") {
      // BuildKit path (M3.1)
      const contextDir = path.join(workspacePath, app.root_dir ?? ".");
      const dockerfileRel = detected.dockerfilePath ?? "Dockerfile";
      const dockerfileAbs = path.join(contextDir, dockerfileRel);
      const cacheDir = path.join(env.PLOYDOK_BUILD_DIR, app.id, ".buildkit-cache");

      log.info({ buildId, imageRef, pushRef }, "starting BuildKit build");
      let imageDigest: string, durationMs: number;
      try {
        ({ imageDigest, durationMs } = await buildImage({
          contextDir,
          dockerfile: dockerfileAbs,
          imageRef: pushRef,
          cacheDir,
          buildArgs: buildEnv,
          buildSecrets: buildEnv,
          onLog,
        }));
      } catch (buildErr) {
        throw classifyAgentError(buildErr);
      }

      log.info({ buildId, imageRef, imageDigest, durationMs }, "BuildKit build + push done");
      await updateBuildStatus(db, buildId, "running", { imageTag: imageRef });

      // If this is a tag deploy, also push the image under the git tag name.
      if (payload.kind === "tag" && payload.tag) {
        await tagManifest(repo, commitSha, payload.tag).catch((tagErr) => {
          log.warn({ tagErr, buildId, tag: payload.tag }, "tag manifest push failed (non-fatal)")
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
          log.warn({ pubErr, buildId }, "eventBus publish deploy.status_change (buildkit) failed (non-fatal)")
        }
      }

      // Post-push GC: keep last 3 images for this app repo.
      gcKeepLast(repo, 3).catch((gcErr) => {
        log.warn({ gcErr, repo }, "post-build GC failed (non-fatal)");
      });
    } else {
      // Nixpacks path
      const nixpacksCache = path.join(env.PLOYDOK_BUILD_DIR, app.id, ".nixpacks-cache");
      log.info({ buildId, imageRef, pushRef }, "starting nixpacks build");
      try {
        await nixpacksBuild({
          workspacePath,
          tag: pushRef,
          cacheKey: app.id,
          cacheDir: nixpacksCache,
          dockerCacheRef: `${pushRegistry}/${repo}:cache`,
          ...(app.root_dir !== null && { rootDir: app.root_dir }),
          ...(app.nixpacks_config_path !== null && { configFile: app.nixpacks_config_path }),
          ...(app.node_version !== null && { nodeVersion: app.node_version }),
          ...(app.install_command !== null && { installCmd: app.install_command }),
          ...(app.build_command !== null && { buildCmd: app.build_command }),
          ...(app.start_command !== null && { startCmd: app.start_command }),
          ...(Object.keys(buildEnv).length > 0 && { buildEnv }),
          onLog,
        });
      } catch (nixErr) {
        throw classifyAgentError(nixErr);
      }

      log.info({ buildId, imageRef }, "nixpacks build + push done");
      await updateBuildStatus(db, buildId, "running", { imageTag: imageRef });

      // If this is a tag deploy, also push the image under the git tag name.
      if (payload.kind === "tag" && payload.tag) {
        await tagManifest(repo, commitSha, payload.tag).catch((tagErr) => {
          log.warn({ tagErr, buildId, tag: payload.tag }, "tag manifest push failed (non-fatal)")
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
          log.warn({ pubErr, buildId }, "eventBus publish deploy.status_change (nixpacks) failed (non-fatal)")
        }
      }

      // Post-push GC: keep last 3 images for this app repo.
      gcKeepLast(repo, 3).catch((gcErr) => {
        log.warn({ gcErr, repo }, "post-build GC failed (non-fatal)");
      });
    }

    // 4. Blue-green deploy — spawn container, healthcheck, Caddy swap.
    // runBlueGreen internally updates apps.container_id + apps.status = 'running'.
    onLog("[deploy] starting blue-green runner");
    // Pre-deploy hook (git source path)
    if (app.hooks_pre_deploy) {
      onLog("[deploy] running pre-deploy hook");
      const preHookCtx = {
        db,
        agent: getSharedAgent(),
        appId: app.id,
        projectId: app.project_id,
        imageRef,
        env: runtimeSecretEnv,
        buildId,
      };
      try {
        await runPreDeployHook(preHookCtx, app.hooks_pre_deploy, app.hooks_timeout_s ?? 300);
      } catch (hookErr) {
        throw classifyAgentError(hookErr);
      }
    }

    let containerId: string;
    try {
      const runOpts: Parameters<typeof runBlueGreen>[0] = {
        appId: app.id,
        imageRef,
        env: runtimeSecretEnv,
        db,
      };
      if (app.runtime_port !== null) runOpts.runtimePort = app.runtime_port;
      ({ containerId } = await runBlueGreen(runOpts));
    } catch (runErr) {
      throw classifyAgentError(runErr);
    }
    onLog(`[deploy] container live: ${containerId}`);

    // Post-deploy hook (git source path) — non-fatal on failure
    if (app.hooks_post_deploy) {
      onLog("[deploy] running post-deploy hook");
      const postHookCtx = {
        db,
        agent: getSharedAgent(),
        appId: app.id,
        projectId: app.project_id,
        imageRef,
        env: runtimeSecretEnv,
        buildId,
      };
      const postResult = await runPostDeployHook(
        postHookCtx,
        app.hooks_post_deploy,
        app.hooks_timeout_s ?? 300,
      );
      if (!postResult.ok) {
        onLog(`[deploy] post-deploy hook failed (non-fatal): ${postResult.error ?? "unknown"}`);
        finalStatus = "succeeded_with_warning";
        finalPatch = { finishedAt: new Date(), containerId, ...(postResult.error ? { postDeployError: postResult.error.slice(0, 500) } : {}) };
        log.warn({ buildId, err: postResult.error }, "post-deploy hook failed (succeeded_with_warning)");
      }
    }

    // Persist containerId into the build record via finalPatch (written once in finally).
    if (finalStatus !== "succeeded_with_warning") {
      finalPatch = { finishedAt: new Date(), containerId };
    }

    // Notify: container is live.
    if (ownerId) {
      try {
        eventBus.publish(`user:${ownerId}`, {
          type: "deploy.status_change",
          appId: app.id,
          buildId,
          message: "Container live",
          data: { containerId, status: "running" },
        })
      } catch (pubErr) {
        log.warn({ pubErr, buildId }, "eventBus publish deploy.status_change (container live) failed (non-fatal)")
      }
    }

    // 5. Mark succeeded (log_path + terminal event written in finally)
    // Note: finalStatus may already be "succeeded_with_warning" if post-deploy hook failed
    if (finalStatus !== "succeeded_with_warning") {
      finalStatus = "succeeded";
    }

    log.info({ buildId, finalStatus }, "deploy completed");

    // 6. Best-effort auto-prune: keep registry tidy after every success.
    //    Honours image protection (running container + latest succeeded build
    //    are never deleted). Failures are logged but never propagated — the
    //    deploy itself already succeeded.
    try {
      const { runRegistryGc } = await import("./gc-registry");
      await runRegistryGc({ db, appFilter: app.id });
    } catch (gcErr) {
      log.warn({ gcErr, appId: app.id, buildId }, "post-deploy auto-prune failed (non-fatal)");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ buildId, err }, "deploy failed");

    finalStatus = "failed";
    finalPatch = { finishedAt: new Date(), errorMessage: msg };
    commitStatusErrorState = err instanceof FatalDeployError ? "failure" : "error";

    // If a previous deploy had put the app in "running", a failed redeploy
    // must NOT overwrite that — blue-green keeps the old container alive.
    // Otherwise (first deploy, previously stopped/failed, etc.) surface the
    // failure on the app row so the dashboard doesn't stick to "created".
    const fallbackStatus: typeof apps.$inferSelect.status =
      app.status === "running" ? "running" : "failed";

    await db
      .update(apps)
      .set({ status: fallbackStatus, updated_at: new Date() })
      .where(eq(apps.id, app.id));

    throw err;
  } finally {
    // Close the log stream and persist log_path in a single updateBuildStatus call.
    await new Promise<void>((resolve) => logStream.end(resolve));
    await updateBuildStatus(db, buildId, finalStatus, {
      ...finalPatch,
      logPath,
      ...(finalPatch.postDeployError !== undefined && { postDeployError: finalPatch.postDeployError }),
    });

    // Commit status — success / failure / error (best-effort, non-fatal)
    if (resolvedCommitShaFinal) {
      const durationMs = Date.now() - deployStartMs;
      const statusState = (finalStatus === "succeeded" || finalStatus === "succeeded_with_warning") ? "success" : commitStatusErrorState;
      postCommitStatusForApp(db, redis, app, {
        sha: resolvedCommitShaFinal,
        state: statusState,
        buildId,
        durationMs,
      }).catch((err) => log.warn({ err, buildId }, `postCommitStatus(${statusState}) failed (non-fatal)`))
    }

    // Publish terminal event AFTER the DB commit so any React Query
    // invalidation triggered by the event fetches the final status.
    if (ownerId) {
      const terminal =
        finalStatus === "succeeded"
          ? { type: "build.succeeded" as const, message: "Build réussi" }
          : finalStatus === "succeeded_with_warning"
            ? { type: "build.succeeded" as const, message: "Build réussi (post-deploy hook en échec)" }
            : {
                type: "build.failed" as const,
                message: `Build échoué: ${(finalPatch.errorMessage ?? "").slice(0, 200)}`,
              };
      try {
        eventBus.publish(`user:${ownerId}`, {
          type: terminal.type,
          appId: app.id,
          buildId,
          message: terminal.message,
        });
      } catch (pubErr) {
        log.warn({ pubErr, buildId }, `eventBus publish ${terminal.type} failed (non-fatal)`);
      }
    }

    // Notification dispatch — build/deploy outcome
    if (ownerId) {
      const durationMs = Date.now() - deployStartMs
      const notifyEvent = (finalStatus === "succeeded" || finalStatus === "succeeded_with_warning") ? "deploy.succeeded" : "deploy.failed"
      dispatch(db, redis, notifyEvent, {
        appId: app.id,
        appName: app.name,
        commitSha: resolvedCommitShaFinal,
        buildId,
        durationMs,
        errorMessage: finalPatch.errorMessage?.slice(0, 500) ?? null,
      }, { userId: ownerId, projectId: app.project_id }).catch((err) =>
        log.warn({ err, buildId }, `dispatch ${notifyEvent} failed (non-fatal)`),
      )
    }

    // Fire-and-forget: enqueue async workspace cleanup via BullMQ.
    cleanupQueue.add("cleanup.build", { appId: payload.appId, buildId }).catch((enqErr) => {
      log.warn({ enqErr, buildId }, "failed to push cleanup.build to BullMQ");
    });
  }
}
