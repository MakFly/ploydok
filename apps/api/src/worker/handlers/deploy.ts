// SPDX-License-Identifier: AGPL-3.0-only
import path from "node:path";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { apps, projects } from "@ploydok/db";
import {
  insertBuild,
  updateBuildStatus,
  enqueueJob,
} from "@ploydok/db/queries";
import type { Db } from "@ploydok/db";
import { env } from "../../env";
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
import { diskGuard, gcKeepLast } from "../registry";
import { workerLog } from "../logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of the `deploy.requested` job payload. */
const DeployPayloadSchema = z.object({
  appId: z.string(),
  commitSha: z.string().nullish(),
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
  install_command: string | null;
  build_command: string | null;
  start_command: string | null;
  build_method: string | null;
  owner_id: string;
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
      install_command: apps.install_command,
      build_command: apps.build_command,
      start_command: apps.start_command,
      build_method: apps.build_method,
      owner_id: projects.owner_id,
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

  if (!app.repo_full_name || !app.branch) {
    throw new Error(`App ${app.id} is missing repo_full_name or branch — cannot deploy`);
  }

  // Create build record
  const buildId = nanoid();
  await insertBuild(db, {
    id: buildId,
    appId: app.id,
    ...(payload.commitSha != null && { commitSha: payload.commitSha }),
  });
  await updateBuildStatus(db, buildId, "running", { startedAt: new Date() });

  log.info({ buildId }, "deploy started");

  try {
    // 1. Clone
    const { installationId, token } = await resolveInstallationTokenForApp(app);
    const ghCache = new GitHubCache();
    const ghProvider = new GitHubProvider(ghCache);
    const cloneUrl = ghProvider.cloneUrlWithToken(app.repo_full_name, token);

    log.info({ buildId, installationId }, "cloning repo");
    const { workspacePath } = await cloneRepo({
      repoCloneUrl: cloneUrl,
      buildDir: env.PLOYDOK_BUILD_DIR,
      appId: app.id,
      buildId,
      branch: app.branch,
    });

    // 2. Detect build method
    const detected = await detectBuildMethod({
      workspacePath,
      override: (app.build_method ?? "auto") as "docker" | "nixpacks" | "auto",
      ...(app.root_dir !== null && { rootDir: app.root_dir }),
      ...(app.dockerfile_path !== null && { dockerfilePath: app.dockerfile_path }),
    });
    log.info({ buildId, method: detected.method }, "build method detected");

    // Guard: abort early if registry disk is too full (threshold = 80 %).
    await diskGuard(80);

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
    const commitSha = payload.commitSha ?? buildId;
    const pushRegistry = stripScheme(env.PLOYDOK_REGISTRY_PUSH_URL);
    const pullRegistry = stripScheme(env.PLOYDOK_REGISTRY_URL);
    const repo = `app-${app.id.toLowerCase()}`;
    const pushRef = `${pushRegistry}/${repo}:${commitSha}`;
    const imageRef = `${pullRegistry}/${repo}:${commitSha}`;

    /** Publish a log line to the pino logger and the LogBus (M3.2). */
    function onLog(line: string) {
      log.debug({ buildId }, line);
      logBus.publish(`build:${buildId}`, line);
    }

    if (detected.method === "docker") {
      // BuildKit path (M3.1)
      const contextDir = path.join(workspacePath, app.root_dir ?? ".");
      const dockerfileRel = detected.dockerfilePath ?? "Dockerfile";
      const dockerfileAbs = path.join(contextDir, dockerfileRel);
      const cacheDir = path.join(env.PLOYDOK_BUILD_DIR, app.id, ".buildkit-cache");

      log.info({ buildId, imageRef, pushRef }, "starting BuildKit build");
      const { imageDigest, durationMs } = await buildImage({
        contextDir,
        dockerfile: dockerfileAbs,
        imageRef: pushRef,
        cacheDir,
        onLog,
      });

      log.info({ buildId, imageRef, imageDigest, durationMs }, "BuildKit build + push done");
      await updateBuildStatus(db, buildId, "running", { imageTag: imageRef });

      // Post-push GC: keep last 3 images for this app repo.
      gcKeepLast(repo, 3).catch((gcErr) => {
        log.warn({ gcErr, repo }, "post-build GC failed (non-fatal)");
      });
    } else {
      // Nixpacks path
      log.info({ buildId, imageRef, pushRef }, "starting nixpacks build");
      await nixpacksBuild({
        workspacePath,
        tag: pushRef,
        ...(app.root_dir !== null && { rootDir: app.root_dir }),
        ...(app.install_command !== null && { installCmd: app.install_command }),
        ...(app.build_command !== null && { buildCmd: app.build_command }),
        ...(app.start_command !== null && { startCmd: app.start_command }),
        onLog,
      });

      log.info({ buildId, imageRef }, "nixpacks build + push done");
      await updateBuildStatus(db, buildId, "running", { imageTag: imageRef });

      // Post-push GC: keep last 3 images for this app repo.
      gcKeepLast(repo, 3).catch((gcErr) => {
        log.warn({ gcErr, repo }, "post-build GC failed (non-fatal)");
      });
    }

    // 4. TODO M3.3: blue-green runner — start container + healthcheck + Caddy swap

    // 5. Mark succeeded
    await updateBuildStatus(db, buildId, "succeeded", { finishedAt: new Date() });
    log.info({ buildId }, "deploy succeeded");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ buildId, err }, "deploy failed");
    await updateBuildStatus(db, buildId, "failed", {
      finishedAt: new Date(),
      errorMessage: msg,
    });
    throw err;
  } finally {
    // Enqueue async workspace cleanup — do not await, this is fire-and-forget.
    enqueueJob(db, {
      type: "cleanup.build",
      payload: { appId: payload.appId, buildId },
    }).catch((enqErr) => {
      log.warn({ enqErr, buildId }, "failed to enqueue cleanup.build job");
    });
  }
}
