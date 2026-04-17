// SPDX-License-Identifier: AGPL-3.0-only
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createDb } from "@ploydok/db";
import { apps, builds, projects } from "@ploydok/db";
import { BuildMethodSchema, HealthcheckConfigSchema } from "@ploydok/shared";
import { getAppForUser, listAppsForUser, listBuildsForApp } from "../queries/apps";
import { enqueueJob } from "@ploydok/db/queries";
import { env } from "../env";
import type { Db } from "@ploydok/db";
import type { AuthUser } from "../auth/middleware";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const GitProviderKindSchema = z.literal("github");

const CreateAppBody = z.object({
  name: z.string().min(1).max(64),
  projectId: z.string().min(1).optional(),
  gitProvider: GitProviderKindSchema,
  repoFullName: z.string().regex(/^[^/]+\/[^/]+$/),
  branch: z.string().min(1),
  installationId: z.string().regex(/^\d+$/).optional(),
  rootDir: z.string().optional(),
  dockerfilePath: z.string().optional(),
  installCommand: z.string().optional(),
  buildCommand: z.string().optional(),
  startCommand: z.string().optional(),
  watchPaths: z.array(z.string()).optional(),
  buildMethod: BuildMethodSchema.optional(),
  healthcheck: HealthcheckConfigSchema.partial().optional(),
  domain: z.string().optional(),
});

// PATCH accepts the same fields except name and projectId are not updatable here
const PatchAppBody = CreateAppBody.omit({ name: true, projectId: true }).partial();

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
    rootDir: row.root_dir,
    dockerfilePath: row.dockerfile_path,
    installCommand: row.install_command,
    buildCommand: row.build_command,
    startCommand: row.start_command,
    watchPaths: row.watch_paths ? (JSON.parse(row.watch_paths) as string[]) : null,
    buildMethod: row.build_method,
    domain: row.domain,
    containerId: row.container_id,
    healthcheck: {
      path: row.healthcheck_path,
      port: row.healthcheck_port,
      intervalS: row.healthcheck_interval_s,
      timeoutS: row.healthcheck_timeout_s,
      retries: row.healthcheck_retries,
      startPeriodS: row.healthcheck_start_period_s,
    },
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
    branch: row.branch,
    buildMethod: row.build_method,
    domain: row.domain,
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
      repo_full_name: body.repoFullName,
      branch: body.branch,
      github_installation_id: body.installationId ?? null,
      root_dir: body.rootDir ?? null,
      dockerfile_path: body.dockerfilePath ?? null,
      install_command: body.installCommand ?? null,
      build_command: body.buildCommand ?? null,
      start_command: body.startCommand ?? null,
      watch_paths: body.watchPaths ? JSON.stringify(body.watchPaths) : null,
      build_method: body.buildMethod ?? "auto",
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

    await enqueueJob(db, {
      type: "deploy.requested",
      payload: { appId: id, commitSha: null },
    })

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

  router.patch("/:id", async (c) => {
    const user = getUser(c);
    const appId = c.req.param("id");

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: Record<string, any> = { updated_at: new Date() };

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
    if (body.domain !== undefined) patch.domain = body.domain;

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

    const updated = await db
      .select()
      .from(apps)
      .where(eq(apps.id, appId))
      .limit(1);

    return c.json({ app: serializeApp(updated[0]!) });
  });

  // -------------------------------------------------------------------------
  // DELETE /apps/:id — Soft delete (status = 'stopped')
  // -------------------------------------------------------------------------

  router.delete("/:id", async (c) => {
    const user = getUser(c);
    const appId = c.req.param("id");

    const existing = await getAppForUser(db, appId, user.id);
    if (!existing) {
      return c.json({ error: { code: "NOT_FOUND", message: "App not found" } }, 404);
    }

    await db
      .update(apps)
      .set({ status: "stopped", updated_at: new Date() })
      .where(eq(apps.id, appId));

    return new Response(null, { status: 204 });
  });

  // -------------------------------------------------------------------------
  // Stubs for endpoints owned by other milestones
  // -------------------------------------------------------------------------

  router.post("/:id/deploy", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json({ error: { code: "NOT_FOUND", message: "App not found" } }, 404)
    }

    const job = await enqueueJob(db, {
      type: "deploy.requested",
      payload: { appId, commitSha: null },
    })

    return c.json({ ok: true, jobId: job.id }, 202)
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

  router.post("/:id/rollback", async (c) => {
    const user = getUser(c);
    const appId = c.req.param("id");

    const app = await getAppForUser(db, appId, user.id);
    if (!app) {
      return c.json({ error: { code: "NOT_FOUND", message: "App not found" } }, 404);
    }

    try {
      const { rollbackApp } = await import("../worker/runner.js");
      await rollbackApp(appId, db);
      return c.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: { code: "ROLLBACK_FAILED", message } }, 500);
    }
  });

  router.post("/:id/stop", async (c) => {
    const user = getUser(c);
    const appId = c.req.param("id");

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

  router.post("/:id/restart", async (c) => {
    const user = getUser(c);
    const appId = c.req.param("id");

    const app = await getAppForUser(db, appId, user.id);
    if (!app) {
      return c.json({ error: { code: "NOT_FOUND", message: "App not found" } }, 404);
    }

    try {
      const { restartApp } = await import("../worker/runner.js");
      await restartApp(appId, db);
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

  router.post("/:id/registry-gc", async (c) => {
    const user = getUser(c);
    const appId = c.req.param("id");

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

  return router;
}

// ---------------------------------------------------------------------------
// Prod singleton — imported by app.ts
// ---------------------------------------------------------------------------

const prodDb = createDb(env.DATABASE_URL);
export const appsRouter = createAppsRouter(prodDb);
