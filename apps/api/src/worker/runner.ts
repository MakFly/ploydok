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
} from "@ploydok/agent-proto";
import { apps, builds } from "@ploydok/db";
import type { Db } from "@ploydok/db";
import { CaddyClient } from "../caddy/client.js";
import { logBus } from "./log-bus.js";

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
  };
  db: Db;
  /** Override Caddy admin URL (useful for tests). */
  caddyBaseUrl?: string;
  /** Override agent socket path (useful for tests). */
  agentSocketPath?: string;
}

export interface RunBlueGreenResult {
  containerId: string;
  color: ContainerColor;
}

// ---------------------------------------------------------------------------
// Agent gRPC client factory
// ---------------------------------------------------------------------------

const DEFAULT_AGENT_SOCKET =
  process.env["PLOYDOK_AGENT_SOCKET"] ?? "/run/ploydok/agent.sock";

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

function containerName(appId: string, color: ContainerColor): string {
  return `ploydok-app-${appId}-${color}`;
}

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
 * Poll the healthcheck endpoint of a container via HTTP.
 * Returns true if healthy within the retry budget.
 */
async function pollHealthcheck(opts: {
  host: string;
  port: number;
  path: string;
  intervalMs: number;
  timeoutMs: number;
  retries: number;
  appId: string;
  color: ContainerColor;
}): Promise<boolean> {
  const url = `http://${opts.host}:${opts.port}${opts.path}`;
  const channel = `runtime:${opts.appId}`;

  for (let attempt = 1; attempt <= opts.retries; attempt++) {
    await sleep(opts.intervalMs);
    const label = `[healthcheck ${attempt}/${opts.retries}]`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      if (res.ok) {
        logBus.publish(channel, `${label} ${url} → ${res.status} OK`);
        return true;
      }
      logBus.publish(channel, `${label} ${url} → ${res.status} (not OK)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logBus.publish(channel, `${label} ${url} → error: ${msg}`);
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
  if (currentContainerId) {
    if (currentContainerId.includes("-blue")) return "blue";
    if (currentContainerId.includes("-green")) return "green";
  }

  // Fallback: check build records.
  const buildRows = await db
    .select({ container_id: builds.container_id })
    .from(builds)
    .where(and(eq(builds.app_id, appId), eq(builds.status, "succeeded")))
    .orderBy(desc(builds.created_at))
    .limit(1);

  const bid = buildRows[0]?.container_id;
  if (bid) {
    if (bid.includes("-blue")) return "blue";
    if (bid.includes("-green")) return "green";
  }

  // Default: treat current as green so we start with blue.
  return "green";
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

  // -- Load app config (healthcheck settings + domain) ----------------------
  const appRows = await db
    .select({
      domain: apps.domain,
      healthcheck_path: apps.healthcheck_path,
      healthcheck_port: apps.healthcheck_port,
      healthcheck_interval_s: apps.healthcheck_interval_s,
      healthcheck_timeout_s: apps.healthcheck_timeout_s,
      healthcheck_retries: apps.healthcheck_retries,
    })
    .from(apps)
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
  const domain = appRow.domain ?? `${appId}.ploydok.local`;

  // -- Determine colors -------------------------------------------------------
  const currentColor = await getCurrentColor(db, appId);
  const newColor = oppositeColor(currentColor);
  const newName = containerName(appId, newColor);
  const oldName = containerName(appId, currentColor);

  logBus.publish(channel, `[runner] blue-green: current=${currentColor} new=${newColor}`);
  logBus.publish(channel, `[runner] starting container ${newName} from ${imageRef}`);

  // -- Agent client ----------------------------------------------------------
  const agentSocket = opts.agentSocketPath ?? DEFAULT_AGENT_SOCKET;
  const agent = createAgentClient(agentSocket);
  const caddyClient = new CaddyClient(opts.caddyBaseUrl);

  let newContainerId: string;

  try {
    // 1. Create container.
    const createResp = await grpcUnary<ContainerCreateResponse>(
      agent.containerCreate.bind(agent),
      {
        name: newName,
        image: imageRef,
        env: containerEnv,
        labels: { "ploydok.app_id": appId, "ploydok.color": newColor },
        network: "ploydok-public",
        volumes: [],
        ports: [],
        restartPolicy: "unless-stopped",
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
      host: newName, // container reachable by name on ploydok-public network
      port: hcPort,
      path: hcPath,
      intervalMs: hcIntervalS * 1_000,
      timeoutMs: hcTimeoutS * 1_000,
      retries: hcRetries,
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

    // 5. Grace period.
    logBus.publish(channel, `[runner] grace period ${GRACE_MS / 1_000}s …`);
    await sleep(GRACE_MS);

    // 6. Stop old container.
    logBus.publish(channel, `[runner] stopping old container ${oldName}`);
    await stopContainer(agent, oldName);
    logBus.publish(channel, `[runner] old container stopped`);

    // 7. Update DB: apps.container_id + status.
    await db
      .update(apps)
      .set({ container_id: newName, status: "running", updated_at: new Date() })
      .where(eq(apps.id, appId));

    return { containerId: newContainerId, color: newColor };
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
  const agentSocket = opts?.agentSocketPath ?? DEFAULT_AGENT_SOCKET;
  const agent = createAgentClient(agentSocket);
  const caddyClient = new CaddyClient(opts?.caddyBaseUrl);

  try {
    await Promise.allSettled([
      stopContainer(agent, containerName(appId, "blue")),
      stopContainer(agent, containerName(appId, "green")),
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
 * Rollback an app to the previous succeeded build image.
 * < 10s target: skips grace period, uses direct container swap.
 */
export async function rollbackApp(
  appId: string,
  db: Db,
  opts?: { agentSocketPath?: string; caddyBaseUrl?: string },
): Promise<void> {
  // Find the two most recent succeeded builds with an image_tag.
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

  // The second-to-last succeeded build is our target.
  const previousBuild = succeededBuilds[1]!;
  if (!previousBuild.image_tag) {
    throw new Error(`Rollback target build ${previousBuild.id} has no image_tag`);
  }

  const channel = `runtime:${appId}`;
  logBus.publish(channel, `[runner] rollback to image ${previousBuild.image_tag}`);

  // Determine the current color (to know which old container to stop).
  const currentColor = await getCurrentColor(db, appId);
  const rollbackColor = oppositeColor(currentColor);
  const rollbackName = containerName(appId, rollbackColor);
  const oldName = containerName(appId, currentColor);

  const agentSocket = opts?.agentSocketPath ?? DEFAULT_AGENT_SOCKET;
  const agent = createAgentClient(agentSocket);

  // Load app healthcheck port for Caddy upstream.
  const appRows = await db
    .select({ domain: apps.domain, healthcheck_port: apps.healthcheck_port })
    .from(apps)
    .where(eq(apps.id, appId))
    .limit(1);

  const appRow = appRows[0];
  if (!appRow) throw new Error(`App not found: ${appId}`);
  const hcPort = appRow.healthcheck_port ?? 3000;
  const domain = appRow.domain ?? `${appId}.ploydok.local`;
  const caddyClient = new CaddyClient(opts?.caddyBaseUrl);

  try {
    // Create + start rollback container.
    const createResp = await grpcUnary<ContainerCreateResponse>(
      agent.containerCreate.bind(agent),
      {
        name: rollbackName,
        image: previousBuild.image_tag,
        env: {},
        labels: { "ploydok.app_id": appId, "ploydok.color": rollbackColor, "ploydok.rollback": "1" },
        network: "ploydok-public",
        volumes: [],
        ports: [],
        restartPolicy: "unless-stopped",
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
    await stopContainer(agent, oldName);
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
 * Restart an app: stop → runBlueGreen from last succeeded build.
 */
export async function restartApp(
  appId: string,
  db: Db,
  opts?: { agentSocketPath?: string; caddyBaseUrl?: string },
): Promise<void> {
  const channel = `runtime:${appId}`;
  logBus.publish(channel, `[runner] restart: stopping current containers`);

  // Find last succeeded build with image_tag.
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

  await stopApp(appId, db, opts);
  logBus.publish(channel, `[runner] restart: re-deploying ${lastBuild.image_tag}`);

  const runOpts: RunBlueGreenOptions = {
    appId,
    imageRef: lastBuild.image_tag,
    env: {},
    db,
  };
  if (opts?.agentSocketPath !== undefined) runOpts.agentSocketPath = opts.agentSocketPath;
  if (opts?.caddyBaseUrl !== undefined) runOpts.caddyBaseUrl = opts.caddyBaseUrl;

  await runBlueGreen(runOpts);

  logBus.publish(channel, `[runner] restart complete`);
}
