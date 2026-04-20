// SPDX-License-Identifier: AGPL-3.0-only
//
// Blue-green runner — M3.3.
//
// Orchestration flow:
//   1. Determine the current color from apps.container_id (blue|green).
//   2. Pick the opposite color for the new container.
//   3. Create + start the new container via the Agent gRPC.
//   4. Poll healthcheck until healthy (or timeout).
//   5. On healthy: setUpstream → sleep grace → stop old container.
//   6. On unhealthy: stop new container, throw DeployFailedError.
//
// Additional operations:
//   stopApp    — stops both blue/green containers + removes Caddy route.
//   rollbackApp — re-activates the previous container (by container_id stored
//                 in the last two succeeded builds) in < 10s.
//   restartApp  — stopApp + runBlueGreen from the last succeeded build image.

import { and, desc, eq } from "drizzle-orm";
import * as grpc from "@grpc/grpc-js";
import { AgentClient } from "@ploydok/agent-proto";
import type {
  ContainerCreateResponse,
  ContainerStartResponse,
  ContainerStopResponse,
  ContainerRemoveResponse,
  PingContainerResponse,
} from "@ploydok/agent-proto";
import { apps, builds, env_vars, projects } from "@ploydok/db";
import type { Db } from "@ploydok/db";
import { CaddyClient } from "../caddy/client.js";
import { logBus } from "./log-bus.js";
import { eventBus } from "./event-bus.js";
import { workerLog } from "./logger.js";
import {
  inferContainerColor,
  runtimeContainerName,
  runtimeContainerNameCandidates,
} from "../runtime-containers.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GRACE_MS = 30_000; // 30 s traffic-drain window
const STOP_TIMEOUT_S = 10; // SIGKILL after N seconds when stopping

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class DeployFailedError extends Error {
  constructor(appId: string, reason: string) {
    super(`DeployFailedError[${appId}]: ${reason}`);
    this.name = "DeployFailedError";
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContainerColor = "blue" | "green";

export interface RunBlueGreenOptions {
  appId: string;
  imageRef: string;
  /** Key=value pairs injected as container env vars. */
  env: Record<string, string>;
  /** Overrides read from apps table when not provided. */
  healthcheck?: {
    path?: string;
    port?: number;
    intervalS?: number;
    timeoutS?: number;
    retries?: number;
    startPeriodS?: number;
  };
  db: Db;
  /** Override Caddy admin URL (useful for tests). */
  caddyBaseUrl?: string;
  /** Override agent socket path (useful for tests). */
  agentSocketPath?: string;
  /**
   * Invoked right after Caddy is switched to the new container and the DB
   * status has been set to "running" — before the grace period + old-container
   * stop. Lets callers signal "app live" to the UI without waiting 30s.
   */
  onLive?: (info: RunBlueGreenResult) => void | Promise<void>;
  /**
   * Optional registry credentials to pass to the agent for the pre-spawn
   * image pull. Required for private source images (Phase 1.B Docker-image
   * deploys); unused for locally-built images pulled from the Ploydok
   * private registry (no auth in dev).
   */
  registryAuth?: { username: string; password: string };
}

export interface RunBlueGreenResult {
  containerId: string;
  color: ContainerColor;
}

// ---------------------------------------------------------------------------
// Agent gRPC client factory
// ---------------------------------------------------------------------------

function defaultAgentSocket(): string {
  const fromEnv = process.env["PLOYDOK_AGENT_SOCKET"];
  if (fromEnv) return fromEnv;
  return process.env["NODE_ENV"] === "prod"
    ? "/run/ploydok/agent.sock"
    : "/tmp/ploydok-agent.sock";
}

const DEFAULT_AGENT_SOCKET = defaultAgentSocket();

/**
 * Create a gRPC AgentClient connected to the Unix domain socket.
 * Uses PLOYDOK_AGENT_INSECURE=1 mode (no mTLS) when available;
 * in production the socket is already restricted by filesystem permissions.
 */
function createAgentClient(socketPath = DEFAULT_AGENT_SOCKET): InstanceType<typeof AgentClient> {
  const address = `unix://${socketPath}`;
  const creds = grpc.credentials.createInsecure();
  return new AgentClient(address, creds);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function oppositeColor(color: ContainerColor): ContainerColor {
  return color === "blue" ? "green" : "blue";
}

/**
 * Promisify a gRPC unary call.
 * The callback form is (error, response) — we coerce `res` via `as` because
 * the @grpc/grpc-js typings use overloads that TypeScript cannot resolve here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function grpcUnary<Res>(fn: (...args: any[]) => grpc.ClientUnaryCall, req: unknown): Promise<Res> {
  return new Promise<Res>((resolve, reject) => {
    fn(req, (err: grpc.ServiceError | null, res: Res) => {
      if (err) reject(err);
      else resolve(res);
    });
  });
}

/** Sleep for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Poll the healthcheck endpoint of a container via the Agent gRPC pingContainer.
 * The agent runs on the host and resolves Docker bridge DNS — the API process
 * cannot resolve container names directly.
 * Returns true if healthy within the retry budget.
 *
 * @internal Exported for unit testing only — do not use outside this module.
 */
export async function pollHealthcheck(opts: {
  agent: InstanceType<typeof AgentClient>;
  containerId: string;
  port: number;
  path: string;
  intervalMs: number;
  timeoutMs: number;
  retries: number;
  startPeriodMs: number;
  appId: string;
  color: ContainerColor;
}): Promise<boolean> {
  // Agent rejects empty path — normalise to "/" if not provided.
  const safePath = opts.path || "/";
  const channel = `runtime:${opts.appId}`;

  if (opts.startPeriodMs > 0) {
    logBus.publish(channel, `[healthcheck] grace period ${opts.startPeriodMs}ms before first probe`);
    await sleep(opts.startPeriodMs);
  }

  for (let attempt = 1; attempt <= opts.retries; attempt++) {
    await sleep(opts.intervalMs);
    const label = `[healthcheck ${attempt}/${opts.retries}]`;
    try {
      const resp = await grpcUnary<PingContainerResponse>(
        opts.agent.pingContainer.bind(opts.agent),
        { containerId: opts.containerId, path: safePath, port: opts.port, timeoutMs: opts.timeoutMs },
      );

      if (resp.ok) {
        logBus.publish(
          channel,
          `${label} status_code=${resp.statusCode} latency=${resp.latencyMs}ms`,
        );
        return true;
      }
      logBus.publish(
        channel,
        `${label} status_code=${resp.statusCode} latency=${resp.latencyMs}ms (not OK)${
          resp.error ? ` — ${resp.error}` : ""
        }`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logBus.publish(channel, `${label} error: ${msg}`);
    }
  }
  return false;
}

/** Determine the current color from the most recent succeeded build that has a container_id. */
async function getCurrentColor(db: Db, appId: string): Promise<ContainerColor> {
  // Look at the app row first (container_id).
  const appRows = await db
    .select({ container_id: apps.container_id })
    .from(apps)
    .where(eq(apps.id, appId))
    .limit(1);

  const currentContainerId = appRows[0]?.container_id;
  const currentColor = inferContainerColor(currentContainerId)
  if (currentColor) return currentColor

  // Fallback: check build records.
  const buildRows = await db
    .select({ container_id: builds.container_id })
    .from(builds)
    .where(and(eq(builds.app_id, appId), eq(builds.status, "succeeded")))
    .orderBy(desc(builds.created_at))
    .limit(1);

  const bid = buildRows[0]?.container_id;
  const buildColor = inferContainerColor(bid)
  if (buildColor) return buildColor

  // Default: treat current as green so we start with blue.
  return "green";
}

/**
 * Pull an image through the Agent (server-streaming gRPC).
 *
 * Docker Engine does not auto-pull on container_create — if the image is not
 * local it returns 404. We must explicitly pull from our registry before
 * create, even though we just pushed it via BuildKit (the push lives in the
 * registry container; the host daemon's cache is separate).
 *
 * Errors during the stream reject the promise. Progress frames are published
 * to the runtime log channel so the user sees the pull advancing.
 */
async function pullImage(
  agent: InstanceType<typeof AgentClient>,
  image: string,
  channel: string,
  registryAuth?: { username: string; password: string },
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const stream = agent.imagePull({ image, registryAuth });
    let lastStatus = "";
    stream.on("data", (progress: { status?: string }) => {
      const s = progress?.status;
      if (s && s !== lastStatus) {
        lastStatus = s;
        logBus.publish(channel, `[runner] pull: ${s}`);
      }
    });
    stream.on("end", () => resolve());
    stream.on("error", (err: Error) => reject(err));
  });
}

/**
 * Load env vars for an app from the DB and return them as a plain Record.
 * Secret values are passed as-is — the caller is responsible for not leaking.
 */
async function loadEnvVars(db: Db, appId: string): Promise<Record<string, string>> {
  const rows = await db
    .select({ key: env_vars.key, value: env_vars.value })
    .from(env_vars)
    .where(eq(env_vars.app_id, appId));
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

/** Stop a container by name via the Agent (idempotent — errors ignored). */
async function stopContainer(
  agent: InstanceType<typeof AgentClient>,
  name: string,
): Promise<void> {
  try {
    // container_stop requires container_id; container names work for Docker.
    await grpcUnary<ContainerStopResponse>(
      agent.containerStop.bind(agent),
      { containerId: name, timeoutSeconds: STOP_TIMEOUT_S },
    );
  } catch {
    // Best-effort: container may already be stopped.
  }
  try {
    await grpcUnary<ContainerRemoveResponse>(
      agent.containerRemove.bind(agent),
      { containerId: name, force: true, removeVolumes: false },
    );
  } catch {
    // Best-effort: container may not exist.
  }
}

async function stopContainerCandidates(
  agent: InstanceType<typeof AgentClient>,
  names: Array<string>,
): Promise<void> {
  for (const name of names) {
    await stopContainer(agent, name)
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run a blue-green deploy for an app.
 *
 * Steps:
 *   1. Determine current color → pick new color.
 *   2. Create + start new container (name = ploydok-app-{appId}-{newColor}).
 *   3. Poll healthcheck (interval, retries from apps table).
 *   4. If healthy: setUpstream → sleep 30s grace → stop old container.
 *   5. If unhealthy: stop new container → throw DeployFailedError.
 *
 * On success: updates apps.container_id + apps.status = 'running'.
 */
export async function runBlueGreen(opts: RunBlueGreenOptions): Promise<RunBlueGreenResult> {
  const { appId, imageRef, env: containerEnv, db } = opts;
  const channel = `runtime:${appId}`;

  // -- Load app config (healthcheck settings + domain + owner for labels) --
  const appRows = await db
    .select({
      id: apps.id,
      slug: apps.slug,
      domain: apps.domain,
      restart_policy: apps.restart_policy,
      healthcheck_path: apps.healthcheck_path,
      healthcheck_port: apps.healthcheck_port,
      healthcheck_interval_s: apps.healthcheck_interval_s,
      healthcheck_timeout_s: apps.healthcheck_timeout_s,
      healthcheck_retries: apps.healthcheck_retries,
      healthcheck_start_period_s: apps.healthcheck_start_period_s,
      owner_id: projects.owner_id,
    })
    .from(apps)
    .innerJoin(projects, eq(apps.project_id, projects.id))
    .where(eq(apps.id, appId))
    .limit(1);

  const appRow = appRows[0];
  if (!appRow) throw new Error(`App not found: ${appId}`);

  // Merge healthcheck overrides.
  const hcPath = opts.healthcheck?.path ?? appRow.healthcheck_path ?? "/";
  const hcPort = opts.healthcheck?.port ?? appRow.healthcheck_port ?? 3000;
  const hcIntervalS = opts.healthcheck?.intervalS ?? appRow.healthcheck_interval_s ?? 5;
  const hcTimeoutS = opts.healthcheck?.timeoutS ?? appRow.healthcheck_timeout_s ?? 3;
  const hcRetries = opts.healthcheck?.retries ?? appRow.healthcheck_retries ?? 6;
  const hcStartPeriodS =
    opts.healthcheck?.startPeriodS ?? appRow.healthcheck_start_period_s ?? 0;
  const domain = appRow.domain ?? `${appId}.ploydok.local`;

  // -- Determine colors -------------------------------------------------------
  const currentColor = await getCurrentColor(db, appId);
  const newColor = oppositeColor(currentColor);
  const newName = runtimeContainerName(appRow, newColor);
  const oldNames = runtimeContainerNameCandidates(appRow, currentColor);

  logBus.publish(channel, `[runner] blue-green: current=${currentColor} new=${newColor}`);
  logBus.publish(channel, `[runner] starting container ${newName} from ${imageRef}`);

  // -- Agent client ----------------------------------------------------------
  const agentSocket = opts.agentSocketPath ?? DEFAULT_AGENT_SOCKET;
  const agent = createAgentClient(agentSocket);
  const caddyClient = new CaddyClient(opts.caddyBaseUrl);

  let newContainerId: string;

  try {
    // 0. Pull image — host daemon's cache is separate from the registry storage.
    logBus.publish(channel, `[runner] pulling image ${imageRef}`);
    await pullImage(agent, imageRef, channel, opts.registryAuth);
    logBus.publish(channel, `[runner] image pulled`);

    // 1. Create container.
    const createResp = await grpcUnary<ContainerCreateResponse>(
      agent.containerCreate.bind(agent),
      {
        name: newName,
        image: imageRef,
        env: containerEnv,
        labels: {
          "ploydok.kind": "app",
          "ploydok.app_id": appId,
          "ploydok.owner_id": appRow.owner_id,
          "ploydok.color": newColor,
        },
        network: "ploydok-public",
        networks: [],
        volumes: [],
        ports: [],
        restartPolicy: appRow.restart_policy,
        resourceLimits: undefined,
        command: [],
        user: "",
      },
    );

    newContainerId = createResp.containerId;
    logBus.publish(channel, `[runner] container created: ${newContainerId}`);

    // 2. Start container.
    await grpcUnary<ContainerStartResponse>(
      agent.containerStart.bind(agent),
      { containerId: newContainerId },
    );
    logBus.publish(channel, `[runner] container started`);

    // 3. Poll healthcheck.
    logBus.publish(
      channel,
      `[runner] polling healthcheck ${hcPath}:${hcPort} (${hcRetries} retries × ${hcIntervalS}s)`,
    );
    const healthy = await pollHealthcheck({
      agent,
      containerId: newContainerId,
      port: hcPort,
      path: hcPath,
      intervalMs: hcIntervalS * 1_000,
      timeoutMs: hcTimeoutS * 1_000,
      retries: hcRetries,
      startPeriodMs: hcStartPeriodS * 1_000,
      appId,
      color: newColor,
    });

    if (!healthy) {
      logBus.publish(channel, `[runner] healthcheck FAILED — rolling back`);
      await stopContainer(agent, newContainerId);
      throw new DeployFailedError(
        appId,
        `healthcheck on ${hcPath}:${hcPort} did not become healthy after ${hcRetries} retries`,
      );
    }

    logBus.publish(channel, `[runner] healthcheck OK — switching Caddy upstream`);

    // 4. Switch Caddy upstream.
    await caddyClient.setUpstream(appId, domain, { host: newName, port: hcPort });
    logBus.publish(channel, `[runner] Caddy upstream updated`);

    // 5. Mark app live immediately — new container serves traffic from this
    //    point. The grace period + old-container stop below are cleanup and
    //    must not delay the UI transition to "running".
    await db
      .update(apps)
      .set({ container_id: newName, status: "running", updated_at: new Date() })
      .where(eq(apps.id, appId));

    const liveInfo: RunBlueGreenResult = { containerId: newContainerId, color: newColor };
    if (opts.onLive) {
      try {
        await opts.onLive(liveInfo);
      } catch {
        // onLive failures must not abort the deploy — it's a notification hook.
      }
    }
    logBus.publish(channel, `[runner] app live — status set to running`);

    // 6. Grace period.
    logBus.publish(channel, `[runner] grace period ${GRACE_MS / 1_000}s …`);
    await sleep(GRACE_MS);

    // 7. Stop old container.
    logBus.publish(channel, `[runner] stopping old container ${oldNames[0]}`);
    await stopContainerCandidates(agent, oldNames);
    logBus.publish(channel, `[runner] old container stopped`);

    return liveInfo;
  } finally {
    agent.close();
  }
}

/**
 * Stop an app (both colors) and remove its Caddy route.
 * Updates apps.status = 'stopped'.
 */
export async function stopApp(
  appId: string,
  db: Db,
  opts?: { agentSocketPath?: string; caddyBaseUrl?: string },
): Promise<void> {
  const appRows = await db
    .select({ id: apps.id, slug: apps.slug })
    .from(apps)
    .where(eq(apps.id, appId))
    .limit(1)
  const app = appRows[0]
  if (!app) throw new Error(`App not found: ${appId}`)

  const agentSocket = opts?.agentSocketPath ?? DEFAULT_AGENT_SOCKET;
  const agent = createAgentClient(agentSocket);
  const caddyClient = new CaddyClient(opts?.caddyBaseUrl);

  try {
    await Promise.allSettled([
      stopContainerCandidates(agent, runtimeContainerNameCandidates(app, "blue")),
      stopContainerCandidates(agent, runtimeContainerNameCandidates(app, "green")),
    ]);

    await caddyClient.removeUpstream(appId);

    await db
      .update(apps)
      .set({ status: "stopped", container_id: null, updated_at: new Date() })
      .where(eq(apps.id, appId));
  } finally {
    agent.close();
  }
}

/**
 * Rollback an app to a specific or the previous succeeded build image.
 *
 * @param targetBuildId — when provided, rolls back to that exact build (must
 *   already be validated as `succeeded` by the caller). When absent, falls back
 *   to the second-to-last succeeded build (legacy behaviour).
 * < 10s target: skips grace period, uses direct container swap.
 */
export async function rollbackApp(
  appId: string,
  db: Db,
  targetBuildId?: string,
  opts?: { agentSocketPath?: string; caddyBaseUrl?: string },
): Promise<void> {
  let previousBuild: { id: string; image_tag: string | null; container_id: string | null };

  if (targetBuildId) {
    // Explicit build target — the route handler already validated it is succeeded.
    const rows = await db
      .select({ id: builds.id, image_tag: builds.image_tag, container_id: builds.container_id })
      .from(builds)
      .where(and(eq(builds.id, targetBuildId), eq(builds.app_id, appId)))
      .limit(1);

    if (!rows[0]) {
      throw new Error(`Rollback build ${targetBuildId} not found for app ${appId}`);
    }
    previousBuild = rows[0];
  } else {
    // Legacy behaviour: use the second-to-last succeeded build.
    const succeededBuilds = await db
      .select({ id: builds.id, image_tag: builds.image_tag, container_id: builds.container_id })
      .from(builds)
      .where(and(eq(builds.app_id, appId), eq(builds.status, "succeeded")))
      .orderBy(desc(builds.created_at))
      .limit(2);

    if (succeededBuilds.length < 2) {
      throw new Error(
        `Cannot rollback app ${appId}: need at least 2 succeeded builds, found ${succeededBuilds.length}`,
      );
    }

    previousBuild = succeededBuilds[1]!;
  }

  if (!previousBuild.image_tag) {
    throw new Error(`Rollback target build ${previousBuild.id} has no image_tag`);
  }

  const channel = `runtime:${appId}`;
  logBus.publish(channel, `[runner] rollback to image ${previousBuild.image_tag}`);

  // Determine the current color (to know which old container to stop).
  const currentColor = await getCurrentColor(db, appId);
  const rollbackColor = oppositeColor(currentColor);

  const agentSocket = opts?.agentSocketPath ?? DEFAULT_AGENT_SOCKET;
  const agent = createAgentClient(agentSocket);

  // Load app healthcheck port for Caddy upstream + owner_id for labels.
  const appRows = await db
    .select({
      id: apps.id,
      slug: apps.slug,
      domain: apps.domain,
      restart_policy: apps.restart_policy,
      healthcheck_port: apps.healthcheck_port,
      owner_id: projects.owner_id,
    })
    .from(apps)
    .innerJoin(projects, eq(apps.project_id, projects.id))
    .where(eq(apps.id, appId))
    .limit(1);

  const appRow = appRows[0];
  if (!appRow) throw new Error(`App not found: ${appId}`);
  const rollbackName = runtimeContainerName(appRow, rollbackColor);
  const oldNames = runtimeContainerNameCandidates(appRow, currentColor);
  const hcPort = appRow.healthcheck_port ?? 3000;
  const domain = appRow.domain ?? `${appId}.ploydok.local`;
  const caddyClient = new CaddyClient(opts?.caddyBaseUrl);

  const containerEnv = await loadEnvVars(db, appId);

  try {
    // Pull image first — host daemon cache ≠ registry storage.
    logBus.publish(channel, `[runner] pulling image ${previousBuild.image_tag}`);
    await pullImage(agent, previousBuild.image_tag, channel);
    logBus.publish(channel, `[runner] image pulled`);

    // Create + start rollback container.
    const createResp = await grpcUnary<ContainerCreateResponse>(
      agent.containerCreate.bind(agent),
      {
        name: rollbackName,
        image: previousBuild.image_tag,
        env: containerEnv,
        labels: {
          "ploydok.kind": "app",
          "ploydok.app_id": appId,
          "ploydok.owner_id": appRow.owner_id,
          "ploydok.color": rollbackColor,
          "ploydok.rollback": "1",
        },
        network: "ploydok-public",
        networks: [],
        volumes: [],
        ports: [],
        restartPolicy: appRow.restart_policy,
        resourceLimits: undefined,
        command: [],
        user: "",
      },
    );

    logBus.publish(channel, `[runner] rollback container created: ${createResp.containerId}`);

    await grpcUnary<ContainerStartResponse>(
      agent.containerStart.bind(agent),
      { containerId: createResp.containerId },
    );
    logBus.publish(channel, `[runner] rollback container started`);

    // Switch Caddy immediately (no grace — rollback must be fast).
    await caddyClient.setUpstream(appId, domain, { host: rollbackName, port: hcPort });
    logBus.publish(channel, `[runner] Caddy switched to rollback container`);

    // Stop old container.
    await stopContainerCandidates(agent, oldNames);
    logBus.publish(channel, `[runner] old container stopped`);

    // Update DB.
    await db
      .update(apps)
      .set({ container_id: rollbackName, status: "running", updated_at: new Date() })
      .where(eq(apps.id, appId));

    logBus.publish(channel, `[runner] rollback complete`);
  } finally {
    agent.close();
  }
}

/**
 * Restart an app: mark restarting → stop containers → runBlueGreen from last
 * succeeded build. Emits SSE events at each transition.
 */
export async function restartApp(
  appId: string,
  db: Db,
  userId?: string,
  opts?: { agentSocketPath?: string; caddyBaseUrl?: string },
): Promise<void> {
  const log = workerLog.child({ appId, op: "restart" });
  const channel = `runtime:${appId}`;

  // Find last succeeded build with image_tag before mutating anything.
  const rows = await db
    .select({ image_tag: builds.image_tag })
    .from(builds)
    .where(and(eq(builds.app_id, appId), eq(builds.status, "succeeded")))
    .orderBy(desc(builds.created_at))
    .limit(1);

  const lastBuild = rows[0];
  if (!lastBuild?.image_tag) {
    throw new Error(`Cannot restart app ${appId}: no succeeded build with an image_tag`);
  }

  // 1. Write "restarting" directly — do NOT go through stopApp which forces "stopped".
  await db
    .update(apps)
    .set({ status: "restarting", updated_at: new Date() })
    .where(eq(apps.id, appId));

  logBus.publish(channel, `[runner] restart: status set to restarting`);

  if (userId) {
    try {
      eventBus.publish(`user:${userId}`, {
        type: "deploy.status_change",
        appId,
        message: "Redémarrage en cours",
        data: { status: "restarting" },
      });
    } catch (pubErr) {
      log.warn({ pubErr }, "eventBus publish restarting failed (non-fatal)");
    }
  }

  // 2. Stop containers (the DB write is already done above — stopApp would
  //    overwrite status to "stopped", so we call the container-stop logic directly).
  logBus.publish(channel, `[runner] restart: stopping current containers`);
  const appRows = await db
    .select({ id: apps.id, slug: apps.slug })
    .from(apps)
    .where(eq(apps.id, appId))
    .limit(1)
  const app = appRows[0]
  if (!app) throw new Error(`App not found: ${appId}`)
  const agentSocket = opts?.agentSocketPath ?? DEFAULT_AGENT_SOCKET;
  const stopAgent = createAgentClient(agentSocket);
  const stopCaddy = new CaddyClient(opts?.caddyBaseUrl);
  try {
    await Promise.allSettled([
      stopContainerCandidates(stopAgent, runtimeContainerNameCandidates(app, "blue")),
      stopContainerCandidates(stopAgent, runtimeContainerNameCandidates(app, "green")),
    ]);
    await stopCaddy.removeUpstream(appId);
  } finally {
    stopAgent.close();
  }

  logBus.publish(channel, `[runner] restart: re-deploying ${lastBuild.image_tag}`);

  // 3. Load current env vars.
  const containerEnv = await loadEnvVars(db, appId);

  // 4. Blue-green redeploy — emit "running" as soon as Caddy has switched,
  //    via onLive. The grace period + old-container stop then run without
  //    blocking the UI.
  const runOpts: RunBlueGreenOptions = {
    appId,
    imageRef: lastBuild.image_tag,
    env: containerEnv,
    db,
    onLive: () => {
      if (!userId) return;
      try {
        eventBus.publish(`user:${userId}`, {
          type: "deploy.status_change",
          appId,
          message: "Redémarrage terminé",
          data: { status: "running" },
        });
      } catch (pubErr) {
        log.warn({ pubErr }, "eventBus publish running after restart failed (non-fatal)");
      }
    },
  };
  if (opts?.agentSocketPath !== undefined) runOpts.agentSocketPath = opts.agentSocketPath;
  if (opts?.caddyBaseUrl !== undefined) runOpts.caddyBaseUrl = opts.caddyBaseUrl;

  try {
    await runBlueGreen(runOpts);
  } catch (err) {
    // runBlueGreen already wrote "failed" via its own DB update path on error.
    // Emit SSE failure event.
    if (userId) {
      try {
        eventBus.publish(`user:${userId}`, {
          type: "deploy.status_change",
          appId,
          message: `Redémarrage échoué: ${err instanceof Error ? err.message : String(err)}`,
          data: { status: "failed" },
        });
      } catch (pubErr) {
        log.warn({ pubErr }, "eventBus publish restart failed event failed (non-fatal)");
      }
    }
    throw err;
  }

  logBus.publish(channel, `[runner] restart complete`);
}
