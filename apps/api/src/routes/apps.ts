// SPDX-License-Identifier: AGPL-3.0-only
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createDb } from "@ploydok/db";
import { apps, audit_log, builds, projects } from "@ploydok/db";
import { BuildMethodSchema, HealthcheckConfigSchema, RestartPolicySchema } from "@ploydok/shared";
import { getAppActivity, getAppForUser, listAppsForUser, listBuildsForApp } from "../queries/apps";
import { listDeliveriesByApp, getDeliveryById } from "../queries/webhook-deliveries";
import { replayDelivery, ReplayLimitError, ReplayPayloadMissingError } from "../webhooks/deliveries";
import { env } from "../env";
import { deployQueue, appDeleteQueue } from "../worker/queues";
import { childLogger } from "../logger";
import type { Db } from "@ploydok/db";
import type { AuthUser } from "../auth/middleware";
import { requireSecondFactor } from "../auth/middleware";
import { requireTotpVerified } from "../auth/second-factor";
import { encryptField, decryptField } from "../github/app-credentials";
import { getSharedAgent } from "../debug/singletons";
import { resolveRuntimeContainer } from "../runtime-containers";
import { dispatch as notifyDispatch } from "../notify/index";
import { createRedis } from "@ploydok/db";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const GitProviderKindSchema = z.enum(["github", "gitlab", "image"]);
const ImagePullPolicySchema = z.enum(["always", "if_not_present"]);
const PlanSchema = z.enum(["nano", "small", "medium", "large", "custom"]);

const CreateAppBody = z.object({
  name: z.string().min(1).max(64),
  projectId: z.string().min(1).optional(),
  gitProvider: GitProviderKindSchema,
  // repoFullName + branch are only required for git sources (github / gitlab).
  repoFullName: z.string().regex(/^[^/]+\/[^/]+$/).optional(),
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
  installCommand: z.string().optional(),
  buildCommand: z.string().optional(),
  startCommand: z.string().optional(),
  watchPaths: z.array(z.string()).optional(),
  buildMethod: BuildMethodSchema.optional(),
  restartPolicy: RestartPolicySchema.optional(),
  healthcheck: HealthcheckConfigSchema.partial().optional(),
  domain: z.string().optional(),
  /** Per-app GC override. null clears the override (falls back to default 3). */
  keepPerRepo: z.number().int().min(0).max(50).nullable().optional(),
});

// PATCH accepts the same fields except name and projectId are not updatable here
const PatchAppBody = CreateAppBody.omit({ name: true, projectId: true })
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
          if (v === null || v === undefined) return true;
          try {
            new RegExp(v);
            return true;
          } catch {
            return false;
          }
        },
        { message: "tag_pattern must be a valid regular expression" },
      ),
  })
  .partial();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

/**
 * Find a slug that doesn't already exist in the given project.
 * If the base slug is taken, append -2, -3, etc.
 */
async function uniqueSlug(
  db: Db,
  projectId: string,
  base: string,
  excludeAppId?: string,
): Promise<string> {
  let candidate = base || "app";
  let attempt = 1;
  for (;;) {
    const existing = await db
      .select({ id: apps.id })
      .from(apps)
      .where(and(eq(apps.project_id, projectId), eq(apps.slug, candidate)))
      .limit(1);

    const conflict = existing.find((r) => r.id !== excludeAppId);
    if (!conflict) return candidate;
    attempt++;
    candidate = `${base}-${attempt}`;
  }
}

function getUser(c: { get: (key: string) => unknown }): AuthUser {
  return c.get("user") as AuthUser;
}

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

type AppRow = typeof apps.$inferSelect;

function nullToUndefined<T>(value: T | null): T | undefined {
  return value ?? undefined;
}

function buildPublicUrl(domain: string | null): string | null {
  if (!domain) return null;
  const port = env.PLOYDOK_PUBLIC_PORT ? `:${env.PLOYDOK_PUBLIC_PORT}` : "";
  return `${env.PLOYDOK_PUBLIC_SCHEME}://${domain}${port}`;
}

function serializeApp(row: AppRow) {
  return {
    id: row.id,
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
    installCommand: nullToUndefined(row.install_command),
    buildCommand: nullToUndefined(row.build_command),
    startCommand: nullToUndefined(row.start_command),
    watchPaths: row.watch_paths ? (JSON.parse(row.watch_paths) as string[]) : undefined,
    buildMethod: row.build_method,
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
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

type AppPartialRow = {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  status: string | null;
  git_provider: string | null;
  repo_full_name: string | null;
  branch: string | null;
  build_method: string | null;
  domain: string | null;
  created_at: Date | null;
  updated_at: Date | null;
};

function serializeAppPartial(row: AppPartialRow) {
  return {
    id: row.id,
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
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

type BuildRow = {
  id: string;
  app_id: string;
  status: string;
  build_method: string | null;
  image_tag: string | null;
  container_id: string | null;
  commit_sha: string | null;
  commit_message: string | null;
  post_deploy_error: string | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date | null;
};

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
    postDeployError: row.post_deploy_error ?? null,
    startedAt: row.started_at instanceof Date ? row.started_at.getTime() : row.started_at,
    finishedAt: row.finished_at instanceof Date ? row.finished_at.getTime() : row.finished_at,
    createdAt: row.created_at instanceof Date ? row.created_at.getTime() : row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Router factory — accepts an injected DB for testability
// ---------------------------------------------------------------------------

export function createAppsRouter(db: Db): Hono {
  const router = new Hono();

  // Second-factor enforcement middleware (must be called after requireAuth).
  // Applied on all state-mutating endpoints except POST /apps (creation).
  const sf = requireSecondFactor(db);

  // -------------------------------------------------------------------------
  // POST /apps — Create a new app
  // -------------------------------------------------------------------------

  router.post("/", async (c) => {
    const user = getUser(c);

    let body: z.infer<typeof CreateAppBody>;
    try {
      body = CreateAppBody.parse(await c.req.json());
    } catch (err) {
      return c.json({ error: { code: "VALIDATION_ERROR", message: String(err) } }, 400);
    }

    // Per-source-type field requirements (Phase 1.A/1.B).
    if (body.gitProvider === "image") {
      if (!body.imageRef) {
        return c.json(
          { error: { code: "VALIDATION_ERROR", message: "imageRef is required for image source" } },
          400,
        );
      }
    } else if (!body.repoFullName || !body.branch) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "repoFullName and branch are required for git sources",
          },
        },
        400,
      );
    }

    const now = new Date();

    // 1. Resolve projectId: explicit → verify ownership; absent → find/create user's default project
    let projectId: string;
    if (body.projectId) {
      const projectRows = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, body.projectId), eq(projects.owner_id, user.id)))
        .limit(1);

      if (!projectRows[0]) {
        return c.json({ error: { code: "NOT_FOUND", message: "Project not found" } }, 404);
      }
      projectId = projectRows[0].id;
    } else {
      const existing = await db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.owner_id, user.id))
        .limit(1);

      if (existing[0]) {
        projectId = existing[0].id;
      } else {
        projectId = nanoid();
        await db.insert(projects).values({
          id: projectId,
          owner_id: user.id,
          name: "Default",
          slug: projectId, // nanoid guarantees global uniqueness on `projects.slug`
          created_at: now,
        });
      }
    }

    // 2. Generate id + slug (unique within project)
    const id = nanoid();
    const baseSlug = slugify(body.name) || "app";
    const slug = await uniqueSlug(db, projectId, baseSlug);

    // 3. Compute domain if absent
    const domainBase = Bun.env["PLOYDOK_DOMAIN_BASE"] ?? "demo.ploydok.local";
    const domain = body.domain ?? `${slug}.${domainBase}`;

    // 4. Build healthcheck fields
    const hc = body.healthcheck ?? {};

    // 5. INSERT
    await db.insert(apps).values({
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
      install_command: body.installCommand ?? null,
      build_command: body.buildCommand ?? null,
      start_command: body.startCommand ?? null,
      watch_paths: body.watchPaths ? JSON.stringify(body.watchPaths) : null,
      build_method: body.buildMethod ?? "auto",
      restart_policy: body.restartPolicy ?? "unless-stopped",
      domain,
      healthcheck_path: hc.path ?? "/",
      healthcheck_port: hc.port ?? null,
      healthcheck_interval_s: hc.intervalS ?? 5,
      healthcheck_timeout_s: hc.timeoutS ?? 3,
      healthcheck_retries: hc.retries ?? 6,
      healthcheck_start_period_s: hc.startPeriodS ?? 0,
    });

    const rows = await db
      .select()
      .from(apps)
      .where(eq(apps.id, id))
      .limit(1);

    await deployQueue.add("deploy.requested", { appId: id, commitSha: null }, { attempts: 1 })

    return c.json({ app: serializeApp(rows[0]!) }, 201);
  });

  // -------------------------------------------------------------------------
  // GET /apps — List apps for the authenticated user
  // -------------------------------------------------------------------------

  router.get("/", async (c) => {
    const user = getUser(c);
    const rows = await listAppsForUser(db, user.id);
    return c.json({ apps: rows.map(serializeAppPartial) });
  });

  // -------------------------------------------------------------------------
  // GET /apps/:id — App details + last 10 builds
  // -------------------------------------------------------------------------

  router.get("/:id", async (c) => {
    const user = getUser(c);
    const appId = c.req.param("id");

    const app = await getAppForUser(db, appId, user.id);
    if (!app) {
      return c.json({ error: { code: "NOT_FOUND", message: "App not found" } }, 404);
    }

    const appBuilds = await listBuildsForApp(db, appId, 10);

    return c.json({
      app: serializeApp(app),
      builds: appBuilds.map(serializeBuild),
    });
  });

  // -------------------------------------------------------------------------
  // PATCH /apps/:id — Update app config
  // -------------------------------------------------------------------------

  router.patch("/:id", sf, async (c) => {
    const user = getUser(c);
    const appId = c.req.param("id")!;

    // Verify ownership
    const existing = await getAppForUser(db, appId, user.id);
    if (!existing) {
      return c.json({ error: { code: "NOT_FOUND", message: "App not found" } }, 404);
    }

    let body: z.infer<typeof PatchAppBody>;
    try {
      body = PatchAppBody.parse(await c.req.json());
    } catch (err) {
      return c.json({ error: { code: "VALIDATION_ERROR", message: String(err) } }, 400);
    }

    // Build update set — only provided fields
    const patch: Record<string, unknown> = { updated_at: new Date() };
    const restartPolicyChanged =
      body.restartPolicy !== undefined && body.restartPolicy !== existing.restart_policy;

    if (body.gitProvider !== undefined) patch.git_provider = body.gitProvider;
    if (body.repoFullName !== undefined) patch.repo_full_name = body.repoFullName;
    if (body.branch !== undefined) patch.branch = body.branch;
    if (body.installationId !== undefined) patch.github_installation_id = body.installationId;
    if (body.rootDir !== undefined) patch.root_dir = body.rootDir;
    if (body.dockerfilePath !== undefined) patch.dockerfile_path = body.dockerfilePath;
    if (body.installCommand !== undefined) patch.install_command = body.installCommand;
    if (body.buildCommand !== undefined) patch.build_command = body.buildCommand;
    if (body.startCommand !== undefined) patch.start_command = body.startCommand;
    if (body.watchPaths !== undefined) patch.watch_paths = JSON.stringify(body.watchPaths);
    if (body.buildMethod !== undefined) patch.build_method = body.buildMethod;
    if (body.restartPolicy !== undefined) patch.restart_policy = body.restartPolicy;
    if (body.domain !== undefined) patch.domain = body.domain;
    if (body.keepPerRepo !== undefined) patch.keep_per_repo = body.keepPerRepo;
    if (body.auto_deploy_enabled !== undefined) patch.auto_deploy_enabled = body.auto_deploy_enabled;
    if (body.post_commit_status !== undefined) patch.post_commit_status = body.post_commit_status;
    if (body.coalesce_pushes !== undefined) patch.coalesce_pushes = body.coalesce_pushes;
    if (body.deploy_on_tag !== undefined) patch.deploy_on_tag = body.deploy_on_tag;
    if (body.tag_pattern !== undefined) patch.tag_pattern = body.tag_pattern;

    // Deploy hooks (Wave 5)
    if ("hooksPreDeploy" in body && body.hooksPreDeploy !== undefined) patch.hooks_pre_deploy = body.hooksPreDeploy;
    if ("hooksPostDeploy" in body && body.hooksPostDeploy !== undefined) patch.hooks_post_deploy = body.hooksPostDeploy;
    if ("hooksTimeoutS" in body && body.hooksTimeoutS !== undefined) patch.hooks_timeout_s = body.hooksTimeoutS;

    if (body.healthcheck !== undefined) {
      const hc = body.healthcheck;
      if (hc.path !== undefined) patch.healthcheck_path = hc.path;
      if (hc.port !== undefined) patch.healthcheck_port = hc.port;
      if (hc.intervalS !== undefined) patch.healthcheck_interval_s = hc.intervalS;
      if (hc.timeoutS !== undefined) patch.healthcheck_timeout_s = hc.timeoutS;
      if (hc.retries !== undefined) patch.healthcheck_retries = hc.retries;
      if (hc.startPeriodS !== undefined) patch.healthcheck_start_period_s = hc.startPeriodS;
    }

    await db.update(apps).set(patch).where(eq(apps.id, appId));

    // Docker only applies restart policy at container creation time.
    // If a running app changes policy, immediately recreate the runtime so the
    // new policy from the DB becomes effective right away.
    if (restartPolicyChanged && existing.status === "running") {
      const { restartApp } = await import("../worker/runner.js");
      await restartApp(appId, db, user.id);
    }

    const updated = await db
      .select()
      .from(apps)
      .where(eq(apps.id, appId))
      .limit(1);

    return c.json({ app: serializeApp(updated[0]!) });
  });

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
  });

  router.delete("/:id", sf, async (c) => {
    const user = getUser(c);
    const appId = c.req.param("id")!;

    const existing = await getAppForUser(db, appId, user.id);
    if (!existing) {
      return c.json({ error: { code: "NOT_FOUND", message: "App not found" } }, 404);
    }

    let flags: z.infer<typeof DeleteAppQuery>;
    try {
      flags = DeleteAppQuery.parse({
        deleteImages: c.req.query("deleteImages"),
        dockerCleanup: c.req.query("dockerCleanup"),
        deleteBuildArtifacts: c.req.query("deleteBuildArtifacts"),
        deleteCaddyRoutes: c.req.query("deleteCaddyRoutes"),
      });
    } catch (err) {
      return c.json({ error: { code: "VALIDATION_ERROR", message: String(err) } }, 400);
    }

    await db
      .update(apps)
      .set({ status: "deleting", updated_at: new Date() })
      .where(eq(apps.id, appId));

    const deletePayload = {
      appId,
      deleteImages: flags.deleteImages ?? true,
      dockerCleanup: flags.dockerCleanup ?? true,
      deleteBuildArtifacts: flags.deleteBuildArtifacts ?? true,
      deleteCaddyRoutes: flags.deleteCaddyRoutes ?? true,
    }
    const bullJob = await appDeleteQueue.add("app.delete.requested", deletePayload)

    childLogger("apps-delete").info(
      { appId, jobId: bullJob.id, flags },
      "delete cascade enqueued",
    );

    return c.json({ ok: true, jobId: bullJob.id, status: "deleting" }, 202);
  });

  // -------------------------------------------------------------------------
  // Stubs for endpoints owned by other milestones
  // -------------------------------------------------------------------------

  router.post("/:id/deploy", sf, async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")!

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json({ error: { code: "NOT_FOUND", message: "App not found" } }, 404)
    }

    const bullJob = await deployQueue.add("deploy.requested", { appId, commitSha: null }, { attempts: 1 })

    // buildId is not available synchronously because the build record is created
    // by the worker when it picks up the job. Returning null here is intentional —
    // the client can poll GET /apps/:id/builds to get the new build once created.
    return c.json({ ok: true, jobId: bullJob.id, buildId: null }, 202)
  })
  // stop / restart / rollback are implemented in the [M3.3 lifecycle] block below.
  router.get("/:id/builds", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json({ error: { code: "NOT_FOUND", message: "App not found" } }, 404)
    }

    const limit = Math.min(Number(c.req.query("limit") ?? 20), 100)
    const appBuilds = await listBuildsForApp(db, appId, limit)
    return c.json({ builds: appBuilds.map(serializeBuild) })
  })
  router.get("/:id/stats", (c) => c.json({ error: "not_implemented_m3_4" }, 501));

  // GET /apps/:id/activity — historical activity timeline derived from builds.
  // Front-end seeds the SSE-driven feed with this so users see recent builds
  // even when the in-memory event ring buffer is cold (e.g. after API restart).
  router.get("/:id/activity", async (c) => {
    const user = getUser(c);
    const appId = c.req.param("id");

    const app = await getAppForUser(db, appId, user.id);
    if (!app) {
      return c.json({ error: { code: "NOT_FOUND", message: "App not found" } }, 404);
    }

    const limit = Math.min(Number(c.req.query("limit") ?? 20), 100);
    const events = await getAppActivity(db, appId, limit);
    return c.json({ events });
  });
  // registry-usage implemented in [M4.2 registry — BEGIN/END] block below.

  // [M3.2 logs — BEGIN]
  // GET /apps/:id/logs?buildId=<buildId>
  // Downloads the archived log file for a build.
  // The file path is stored in builds.log_path (set by the build worker).
  // Returns the raw log as text/plain.
  router.get("/:id/logs", async (c) => {
    const user = getUser(c);
    const appId = c.req.param("id");
    const buildId = c.req.query("buildId");

    if (!buildId) {
      return c.json(
        { error: { code: "VALIDATION_ERROR", message: "buildId query param is required" } },
        400,
      );
    }

    // Verify app ownership.
    const app = await getAppForUser(db, appId, user.id);
    if (!app) {
      return c.json({ error: { code: "NOT_FOUND", message: "App not found" } }, 404);
    }

    // Load build row and verify it belongs to this app.
    const buildRows = await db
      .select({ id: builds.id, app_id: builds.app_id, log_path: builds.log_path })
      .from(builds)
      .where(and(eq(builds.id, buildId), eq(builds.app_id, appId)))
      .limit(1);

    const build = buildRows[0];
    if (!build) {
      return c.json({ error: { code: "NOT_FOUND", message: "Build not found" } }, 404);
    }

    if (!build.log_path) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "No archived log file for this build" } },
        404,
      );
    }

    let content: Buffer;
    try {
      content = await readFile(build.log_path);
    } catch {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Log file not found on disk" } },
        404,
      );
    }

    return new Response(content, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="build-${buildId}.log"`,
      },
    });
  });

  router.get("/:id/runtime-logs", async (c) => {
    const user = getUser(c);
    const appId = c.req.param("id");
    const tailRaw = Number(c.req.query("tail") ?? 200);
    const tail = Number.isFinite(tailRaw)
      ? Math.max(1, Math.min(Math.floor(tailRaw), 1_000))
      : 200

    const app = await getAppForUser(db, appId, user.id);
    if (!app) {
      return c.json({ error: { code: "NOT_FOUND", message: "App not found" } }, 404);
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

      const lines: Array<{ t: number; line: string; stream?: "stdout" | "stderr" }> = []
      for await (const line of agent.containerLogs({
        containerId: container.id,
        follow: false,
        sinceUnix: 0,
        tail,
      })) {
        const entry: { t: number; line: string; stream?: "stdout" | "stderr" } = {
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
      const message = err instanceof Error ? err.message : String(err);
      return c.json(
        { error: { code: "RUNTIME_LOGS_ERROR", message } },
        500,
      );
    }
  });

  // Also replace the former stub for /:id/builds/:buildId/logs with a redirect
  // to the canonical log download endpoint above.
  router.get("/:id/builds/:buildId/logs", (c) => {
    const appId = c.req.param("id") ?? "";
    const buildId = c.req.param("buildId") ?? "";
    return c.redirect(`/apps/${appId}/logs?buildId=${buildId}`, 302);
  });
  // [M3.2 logs — END]

  // [M3.3 lifecycle — BEGIN]
  // POST /apps/:id/rollback — roll back to the previous succeeded build
  // POST /apps/:id/stop    — stop both containers + remove Caddy route
  // POST /apps/:id/restart — stop + re-deploy from last succeeded build image
  // All routes require auth + ownership.

  const RollbackBody = z.object({
    buildId: z.string().optional(),
  });

  router.post("/:id/rollback", sf, async (c) => {
    const user = getUser(c);
    const appId = c.req.param("id")!;

    const app = await getAppForUser(db, appId, user.id);
    if (!app) {
      return c.json({ error: { code: "NOT_FOUND", message: "App not found" } }, 404);
    }

    // Parse optional body — empty body is also valid (legacy behaviour)
    let body: z.infer<typeof RollbackBody> = {};
    try {
      const raw = await c.req.text();
      if (raw.trim()) {
        body = RollbackBody.parse(JSON.parse(raw));
      }
    } catch {
      return c.json({ error: { code: "VALIDATION_ERROR", message: "Invalid request body" } }, 400);
    }

    // If an explicit buildId is provided, validate it exists and has status succeeded
    if (body.buildId) {
      const targetBuildRows = await db
        .select({ id: builds.id, app_id: builds.app_id, status: builds.status })
        .from(builds)
        .where(and(eq(builds.id, body.buildId), eq(builds.app_id, appId)))
        .limit(1);

      const targetBuild = targetBuildRows[0];
      if (!targetBuild) {
        return c.json({ error: { code: "NOT_FOUND", message: "Build not found for this app" } }, 404);
      }
      if (targetBuild.status !== "succeeded") {
        return c.json({
          error: {
            code: "INVALID_BUILD_STATUS",
            message: `Cannot rollback to build with status '${targetBuild.status}' — only succeeded builds are allowed`,
          },
        }, 400);
      }
    }

    try {
      const { rollbackApp } = await import("../worker/runner.js");
      await rollbackApp(appId, db, body.buildId, undefined);
      return c.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: { code: "ROLLBACK_FAILED", message } }, 500);
    }
  });

  router.post("/:id/stop", sf, async (c) => {
    const user = getUser(c);
    const appId = c.req.param("id")!;

    const app = await getAppForUser(db, appId, user.id);
    if (!app) {
      return c.json({ error: { code: "NOT_FOUND", message: "App not found" } }, 404);
    }

    try {
      const { stopApp } = await import("../worker/runner.js");
      await stopApp(appId, db);
      return c.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: { code: "STOP_FAILED", message } }, 500);
    }
  });

  router.post("/:id/restart", sf, async (c) => {
    const user = getUser(c);
    const appId = c.req.param("id")!;

    const app = await getAppForUser(db, appId, user.id);
    if (!app) {
      return c.json({ error: { code: "NOT_FOUND", message: "App not found" } }, 404);
    }

    try {
      const { restartApp } = await import("../worker/runner.js");
      await restartApp(appId, db, user.id);
      return c.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: { code: "RESTART_FAILED", message } }, 500);
    }
  });
  // [M3.3 lifecycle — END]

  // [M4.2 registry — BEGIN]
  // GET  /apps/:id/registry-usage  — per-app registry stats (requires auth + ownership).
  // POST /apps/:id/registry-gc     — trigger an immediate GC prune for this app (owner only).

  router.get("/:id/registry-usage", async (c) => {
    const user = getUser(c);
    const appId = c.req.param("id");

    const app = await getAppForUser(db, appId, user.id);
    if (!app) {
      return c.json({ error: { code: "NOT_FOUND", message: "App not found" } }, 404);
    }

    try {
      const { getRegistryUsageForApp } = await import(
        "../worker/handlers/gc-registry.js"
      );
      const usage = await getRegistryUsageForApp(appId, db);
      return c.json(usage);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json(
        { error: { code: "REGISTRY_ERROR", message } },
        500,
      );
    }
  });

  router.post("/:id/registry-gc", sf, async (c) => {
    const user = getUser(c);
    const appId = c.req.param("id")!;

    const app = await getAppForUser(db, appId, user.id);
    if (!app) {
      return c.json({ error: { code: "NOT_FOUND", message: "App not found" } }, 404);
    }

    try {
      const { runRegistryGc } = await import(
        "../worker/handlers/gc-registry.js"
      );
      const result = await runRegistryGc({ db, appFilter: appId });
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json(
        { error: { code: "GC_FAILED", message } },
        500,
      );
    }
  });
  // [M4.2 registry — END]

  // [Wave-3 webhooks — BEGIN]

  // -------------------------------------------------------------------------
  // GET /apps/:id/webhook-deliveries — list deliveries (cursor pagination)
  // -------------------------------------------------------------------------

  router.get("/:id/webhook-deliveries", async (c) => {
    const user = getUser(c);
    const appId = c.req.param("id");

    const limitRaw = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 50;
    const cursor = c.req.query("cursor");

    const result = await listDeliveriesByApp(db, appId, user.id, limit, cursor);
    if (result === null) {
      return c.json({ error: { code: "NOT_FOUND", message: "App not found" } }, 404);
    }

    return c.json(result);
  });

  // -------------------------------------------------------------------------
  // GET /apps/:id/webhook-deliveries/:deliveryId — single delivery detail
  // -------------------------------------------------------------------------

  router.get("/:id/webhook-deliveries/:deliveryId", async (c) => {
    const user = getUser(c);
    const appId = c.req.param("id");
    const deliveryId = c.req.param("deliveryId");

    const delivery = await getDeliveryById(db, appId, deliveryId, user.id);
    if (delivery === null) {
      return c.json({ error: { code: "NOT_FOUND", message: "Delivery not found" } }, 404);
    }

    return c.json({ delivery });
  });

  // -------------------------------------------------------------------------
  // POST /apps/:id/webhook-secret/rotate — rotate per-app webhook secret
  // Protected by requireTotpVerified. Anti-abuse: 409 if rotated < 24h ago.
  // -------------------------------------------------------------------------

  const totpMw = requireTotpVerified(db);

  router.post("/:id/webhook-secret/rotate", totpMw, async (c) => {
    const user = getUser(c);
    const appId = c.req.param("id")!;

    const app = await getAppForUser(db, appId, user.id);
    if (!app) {
      return c.json({ error: { code: "NOT_FOUND", message: "App not found" } }, 404);
    }

    // Anti-abuse: reject if the existing old secret hasn't expired yet (< 24h since last rotation)
    const now = new Date();
    if (app.webhook_secret_old_expires_at && app.webhook_secret_old_expires_at > now) {
      return c.json({ code: "rotation_cooldown", message: "A rotation already happened in the last 24h" }, 409);
    }

    const newSecretPlain = randomBytes(32).toString("hex");
    const { enc, nonce } = await encryptField(newSecretPlain);
    // Store as nonce (12 bytes) || enc concatenated in a single bytea
    const newSecretBlob = Buffer.concat([nonce, enc]);

    // Move current secret → old before overwriting
    await db
      .update(apps)
      .set({
        webhook_secret: newSecretBlob,
        webhook_secret_old: app.webhook_secret ?? null,
        webhook_secret_old_expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        updated_at: now,
      })
      .where(eq(apps.id, appId));

    // Audit
    try {
      await db.insert(audit_log).values({
        user_id: user.id,
        action: "webhook.secret.rotated",
        target_type: "app",
        target_id: appId,
        metadata: "{}",
        created_at: now,
      });
    } catch {
      // Audit failure must not block the response
    }

    childLogger("apps-webhook-secret").info({ appId, userId: user.id }, "webhook secret rotated");

    // Notification dispatch — webhook.rotated (best-effort, non-fatal)
    const redisForNotify = createRedis(env.REDIS_URL);
    notifyDispatch(db, redisForNotify, "webhook.rotated", {
      appId: app.id,
      appName: app.name,
    }, { userId: user.id, projectId: app.project_id ?? undefined }).catch((err) =>
      childLogger("apps-webhook-secret").warn({ err, appId }, "dispatch webhook.rotated failed (non-fatal)"),
    ).finally(() => redisForNotify.disconnect())

    // Return plain secret once — caller must copy it to GitHub/GitLab
    return c.json({ secret: newSecretPlain });
  });

  // -------------------------------------------------------------------------
  // POST /apps/:id/webhook-deliveries/:deliveryId/replay — replay a delivery
  // Protected by TOTP. Anti-abuse: max 10 replays per parent delivery → 429.
  // -------------------------------------------------------------------------

  router.post("/:id/webhook-deliveries/:deliveryId/replay", totpMw, async (c) => {
    const user = getUser(c);
    const appId = c.req.param("id")!;
    const deliveryId = c.req.param("deliveryId")!;

    // Verify ownership
    const app = await getAppForUser(db, appId, user.id);
    if (!app) {
      return c.json({ error: { code: "NOT_FOUND", message: "App not found" } }, 404);
    }

    try {
      const newDeliveryId = await replayDelivery(db, deliveryId, appId);

      // Audit
      try {
        await db.insert(audit_log).values({
          user_id: user.id,
          action: "webhook.replayed",
          target_type: "app",
          target_id: appId,
          metadata: JSON.stringify({ delivery_id: deliveryId, new_delivery_id: newDeliveryId }),
          created_at: new Date(),
        });
      } catch {
        // Audit failure must not block the response
      }

      childLogger("apps-webhook-replay").info(
        { appId, userId: user.id, deliveryId, newDeliveryId },
        "delivery replayed",
      );

      return c.json({ delivery_id: newDeliveryId });
    } catch (err) {
      if (err instanceof ReplayLimitError) {
        return c.json({ code: err.code, message: err.message }, 429);
      }
      if (err instanceof ReplayPayloadMissingError) {
        return c.json({ code: err.code, message: err.message }, 422);
      }
      if (err instanceof Error && err.message === "Delivery not found") {
        return c.json({ error: { code: "NOT_FOUND", message: "Delivery not found" } }, 404);
      }
      throw err;
    }
  });

  // [Wave-3 webhooks — END]

  return router;
}

// ---------------------------------------------------------------------------
// Prod singleton — imported by app.ts
// ---------------------------------------------------------------------------

const prodDb = createDb(env.DATABASE_URL);
export const appsRouter = createAppsRouter(prodDb);
