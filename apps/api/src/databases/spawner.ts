// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from "node:crypto"
import { nanoid } from "nanoid"
import { databases } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { and, desc, eq, gte, isNotNull, lt, max } from "drizzle-orm"
import { childLogger } from "../logger"
import { encryptSecret, decryptSecret } from "../secrets/crypto"
import { ensureProjectNetwork } from "../projects"
import { ensureCaddyOnProjectNetwork } from "../caddy/attachment"
import { getSharedAgent, getSharedCaddy } from "../debug/singletons"
import type { HealthcheckConfig } from "../agent"
import { templates } from "./templates/index"
import type { DatabaseRow } from "@ploydok/db"

const log = childLogger("databases.spawner")

const AGENT_CONTAINER_NAME_RE = /^ploydok-[a-z0-9][a-z0-9-]{0,62}$/
const DATABASE_HEALTHCHECK_TIMEOUT_MS = 90_000
const DATABASE_HEALTHCHECK_POLL_MS = 1_000

export type DbKind = "postgres" | "mysql" | "mariadb" | "redis" | "mongo"
export type DbPlan = "small" | "medium" | "large"
export type DbExposureMode = "internal" | "direct_port" | "public_proxy"
export type DbHealthStatus = "unknown" | "starting" | "healthy" | "degraded" | "unhealthy"

interface SpawnOptions {
  projectId: string
  ownerId: string
  kind: DbKind
  name: string
  plan: DbPlan
  exposureMode?: DbExposureMode
  publicEnabled?: boolean
}

interface SpawnResult {
  id: string
  containerId: string
  connectionString: string
}

interface RecreateOptions {
  ownerId: string
  publicEnabled: boolean
  exposureMode: DbExposureMode
}

type RuntimeContainerStatus = "running" | "unhealthy" | "starting" | "stopped" | "unknown"

function generatePassword(): string {
  return randomBytes(24).toString("base64url")
}

function normalizeDatabaseRuntimeToken(dbId: string, maxLength: number): string {
  const normalized = dbId
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)

  return normalized || "db"
}

function containerName(dbId: string): string {
  return `ploydok-db-${normalizeDatabaseRuntimeToken(dbId, 60)}`
}

function volumeName(dbId: string): string {
  return `ploydok-db-${normalizeDatabaseRuntimeToken(dbId, 120)}`
}

function defaultPublicHost(): string {
  return "localhost"
}

function tcpProxyServerId(dbId: string): string {
  return `ploydok-db-proxy-${normalizeDatabaseRuntimeToken(dbId, 54)}`
}

function hasValidAgentContainerName(name: string | null | undefined): name is string {
  return typeof name === "string" && AGENT_CONTAINER_NAME_RE.test(name)
}

function databaseContainerLabels(opts: {
  dbId: string
  ownerId: string
  projectId: string
}): Record<string, string> {
  return {
    "ploydok.kind": "database",
    "ploydok.db_id": opts.dbId,
    "ploydok.project_id": opts.projectId,
    "ploydok.app_id": opts.dbId,
    "ploydok.owner_id": opts.ownerId,
  }
}

function buildDatabaseHealthcheck(command: string): HealthcheckConfig {
  return {
    test: ["CMD-SHELL", command],
    intervalSeconds: 5,
    timeoutSeconds: 5,
    retries: 12,
    startPeriodSeconds: 10,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForDatabaseHealthy(
  containerId: string,
  agent = getSharedAgent(),
): Promise<void> {
  const deadline = Date.now() + DATABASE_HEALTHCHECK_TIMEOUT_MS

  while (Date.now() < deadline) {
    const { containers } = await agent.listContainers({ kindFilter: "" })
    const container = containers.find((entry) => entry.id === containerId)

    if (!container) {
      await sleep(DATABASE_HEALTHCHECK_POLL_MS)
      continue
    }

    const status = (container.status || "unknown") as RuntimeContainerStatus
    if (status === "running") return
    if (status === "unhealthy" || status === "stopped") {
      throw new Error(`database healthcheck failed: container is ${status}`)
    }

    await sleep(DATABASE_HEALTHCHECK_POLL_MS)
  }

  throw new Error(`database healthcheck timed out after ${DATABASE_HEALTHCHECK_TIMEOUT_MS}ms`)
}

function resolveEnv(
  templateEnv: Record<string, string>,
  password: string,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(templateEnv)) {
    out[k] = v === "@generated(32)" ? password : v
  }
  return out
}

function resolveArgs(args: string[] | undefined, password: string): string[] {
  if (!args) return []
  return args.map((a) => (a === "@generated(32)" ? password : a))
}

function buildConnectionString(
  template: string,
  values: {
    user: string
    password: string
    host: string
    port: number
    database: string
  },
): string {
  return template
    .replace("{user}", encodeURIComponent(values.user))
    .replace("{password}", encodeURIComponent(values.password))
    .replace("{host}", values.host)
    .replace("{port}", String(values.port))
    .replace("{database}", values.database)
}

function getCredentials(
  kind: DbKind,
  resolvedEnv: Record<string, string>,
  resolvedArgs: string[],
): { user: string; password: string; database: string } {
  switch (kind) {
    case "postgres":
      return {
        user: resolvedEnv["POSTGRES_USER"] ?? "ploydok",
        password: resolvedEnv["POSTGRES_PASSWORD"] ?? "",
        database: resolvedEnv["POSTGRES_DB"] ?? "app",
      }
    case "mysql":
      return {
        user: resolvedEnv["MYSQL_USER"] ?? "ploydok",
        password: resolvedEnv["MYSQL_PASSWORD"] ?? "",
        database: resolvedEnv["MYSQL_DATABASE"] ?? "app",
      }
    case "mariadb":
      return {
        user: resolvedEnv["MARIADB_USER"] ?? "ploydok",
        password: resolvedEnv["MARIADB_PASSWORD"] ?? "",
        database: resolvedEnv["MARIADB_DATABASE"] ?? "app",
      }
    case "redis": {
      const pwIdx = resolvedArgs.indexOf("--requirepass")
      return {
        user: "",
        password: pwIdx !== -1 ? (resolvedArgs[pwIdx + 1] ?? "") : "",
        database: "0",
      }
    }
    case "mongo":
      return {
        user: resolvedEnv["MONGO_INITDB_ROOT_USERNAME"] ?? "ploydok",
        password: resolvedEnv["MONGO_INITDB_ROOT_PASSWORD"] ?? "",
        database: resolvedEnv["MONGO_INITDB_DATABASE"] ?? "app",
      }
  }
}

function parseStoredConnectionString(
  kind: DbKind,
  connString: string,
): { user: string; password: string; database: string } {
  const url = new URL(connString)
  switch (kind) {
    case "postgres":
    case "mysql":
    case "mariadb":
      return {
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: url.pathname.replace(/^\//, "") || "app",
      }
    case "mongo":
      return {
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: url.pathname.replace(/^\//, "").split("?")[0] || "app",
      }
    case "redis":
      return {
        user: "",
        password: decodeURIComponent(url.password),
        database: url.pathname.replace(/^\//, "") || "0",
      }
  }
}

function runtimeEnvForDatabase(
  kind: DbKind,
  creds: { user: string; password: string; database: string },
): Record<string, string> {
  switch (kind) {
    case "postgres":
      return {
        POSTGRES_USER: creds.user,
        POSTGRES_PASSWORD: creds.password,
        POSTGRES_DB: creds.database,
      }
    case "mysql":
      return {
        MYSQL_DATABASE: creds.database,
        MYSQL_USER: creds.user,
        MYSQL_PASSWORD: creds.password,
        MYSQL_ROOT_PASSWORD: creds.password,
      }
    case "mariadb":
      return {
        MARIADB_DATABASE: creds.database,
        MARIADB_USER: creds.user,
        MARIADB_PASSWORD: creds.password,
        MARIADB_ROOT_PASSWORD: creds.password,
      }
    case "mongo":
      return {
        MONGO_INITDB_ROOT_USERNAME: creds.user,
        MONGO_INITDB_ROOT_PASSWORD: creds.password,
        MONGO_INITDB_DATABASE: creds.database,
      }
    case "redis":
      return {}
  }
}

function runtimeArgsForDatabase(kind: DbKind, password: string): string[] {
  if (kind === "redis") return ["--requirepass", password]
  return []
}

function buildPublicUrl(kind: DbKind, host: string, port: number): string {
  switch (kind) {
    case "postgres":
      return `postgresql://${host}:${port}`
    case "mysql":
    case "mariadb":
      return `mysql://${host}:${port}`
    case "mongo":
      return `mongodb://${host}:${port}`
    case "redis":
      return `redis://${host}:${port}`
  }
}

const DIRECT_PORT_MIN = 15432
const PROXY_PORT_MIN = 16432

async function allocatePublicPort(db: Db): Promise<number> {
  const rows = await db
    .select({ max_port: max(databases.public_port) })
    .from(databases)
    .where(
      and(
        isNotNull(databases.public_port),
        gte(databases.public_port, DIRECT_PORT_MIN),
        lt(databases.public_port, PROXY_PORT_MIN),
      ),
    )
  const maxUsed = rows[0]?.max_port ?? DIRECT_PORT_MIN - 1
  return Math.max(maxUsed + 1, DIRECT_PORT_MIN)
}

async function allocatePublicProxyPort(db: Db): Promise<number> {
  const rows = await db
    .select({ max_port: max(databases.public_port) })
    .from(databases)
    .where(and(isNotNull(databases.public_port), gte(databases.public_port, PROXY_PORT_MIN)))
  const maxUsed = rows[0]?.max_port ?? PROXY_PORT_MIN - 1
  return Math.max(maxUsed + 1, PROXY_PORT_MIN)
}

async function updateConnectionSecrets(
  db: Db,
  id: string,
  connectionString: string,
  password: string,
): Promise<void> {
  const { enc: connEnc, nonce: connNonce } = await encryptSecret(connectionString)
  const { enc: pwEnc, nonce: pwNonce } = await encryptSecret(password)

  await db
    .update(databases)
    .set({
      connection_string_enc: connEnc,
      connection_string_nonce: connNonce,
      master_password_enc: pwEnc,
      master_password_nonce: pwNonce,
    })
    .where(eq(databases.id, id))
}

async function buildRuntimeConfig(
  db: Db,
  opts: {
    id: string
    projectId: string
    kind: DbKind
    plan: DbPlan
    volumeName: string
    host: string
    creds: { user: string; password: string; database: string }
    exposureMode: DbExposureMode
    publicEnabled: boolean
  },
): Promise<{
  template: (typeof templates)[DbKind]
  env: Record<string, string>
  args: string[]
  ports: Array<{ containerPort: number; hostPort: number; proto: string }>
  publicPort: number | null
  publicHost: string | null
  publicUrl: string | null
  connectionString: string
}> {
  const tmpl = templates[opts.kind]
  const env = runtimeEnvForDatabase(opts.kind, opts.creds)
  const args = runtimeArgsForDatabase(opts.kind, opts.creds.password)
  const publicPort =
    !opts.publicEnabled
      ? null
      : opts.exposureMode === "direct_port"
        ? await allocatePublicPort(db)
        : opts.exposureMode === "public_proxy"
          ? await allocatePublicProxyPort(db)
          : null
  const publicHost = publicPort ? defaultPublicHost() : null
  const publicUrl = publicPort && publicHost ? buildPublicUrl(opts.kind, publicHost, publicPort) : null
  const ports =
    publicPort !== null && opts.exposureMode === "direct_port"
      ? [{ containerPort: tmpl.port, hostPort: publicPort, proto: "tcp" }]
      : []
  const connectionString = buildConnectionString(tmpl.connection_string, {
    user: opts.creds.user,
    password: opts.creds.password,
    host: opts.host,
    port: tmpl.port,
    database: opts.creds.database,
  })

  return {
    template: tmpl,
    env,
    args,
    ports,
    publicPort,
    publicHost,
    publicUrl,
    connectionString,
  }
}

export async function spawnDatabase(db: Db, opts: SpawnOptions): Promise<SpawnResult> {
  const { projectId, ownerId, kind, name, plan } = opts
  const tmpl = templates[kind]
  const planCfg = tmpl.plans[plan]
  const exposureMode = opts.exposureMode ?? "internal"
  const publicEnabled = Boolean(opts.publicEnabled) && exposureMode !== "internal"

  const id = nanoid()
  const password = generatePassword()
  const resolvedEnv = resolveEnv(tmpl.env, password)
  const resolvedArgs = resolveArgs(tmpl.args, password)
  const creds = getCredentials(kind, resolvedEnv, resolvedArgs)
  const host = containerName(id)
  const vol = volumeName(id)
  const runtime = await buildRuntimeConfig(db, {
    id,
    projectId,
    kind,
    plan,
    volumeName: vol,
    host,
    creds,
    exposureMode,
    publicEnabled,
  })

  await db.insert(databases).values({
    id,
    project_id: projectId,
    kind,
    version: tmpl.version,
    name,
    plan,
    volume_name: vol,
    status: "creating",
    health_status: "starting",
    host,
    port: tmpl.port,
    exposure_mode: exposureMode,
    public_enabled: publicEnabled,
    public_port: runtime.publicPort,
    public_host: runtime.publicHost,
    public_url: runtime.publicUrl,
  })

  try {
    const agent = getSharedAgent()
    const caddy = getSharedCaddy()

    const networkName = await ensureProjectNetwork(db, projectId, agent)
    if (publicEnabled && exposureMode === "public_proxy") {
      await ensureCaddyOnProjectNetwork(agent, networkName)
    }
    try {
      await agent.networkCreate({ name: networkName, driver: "bridge", labels: {} })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes("already exists") && !msg.includes("ALREADY_EXISTS")) {
        log.warn({ err, networkName }, "networkCreate non-fatal warning")
      }
    }

    // VolumeCreate via agent (mapped to containerCreate with volume mount)
    // The agent handles volumes through container create volume mount spec.

    const memLimitBytes = BigInt(planCfg.mem_mb) * BigInt(1024 * 1024)

    const containerRes = await agent.containerCreate({
      name: host,
      image: tmpl.image,
      env: runtime.env,
      command: runtime.args,
      networks: [networkName],
      network: networkName,
      volumes: [{ hostPath: `/var/lib/ploydok/volumes/${vol}`, containerPath: tmpl.volume_path, readOnly: false }],
      ports: runtime.ports,
      restartPolicy: "unless-stopped",
      resourceLimits: {
        cpu: planCfg.cpu,
        memoryBytes: Number(memLimitBytes),
        pidsLimit: 0,
      },
      healthcheck: buildDatabaseHealthcheck(tmpl.healthcheck),
      labels: databaseContainerLabels({ dbId: id, ownerId, projectId }),
      user: "",
    })

    await db
      .update(databases)
      .set({
        container_id: containerRes.containerId,
        status: "starting",
        health_status: "starting",
      })
      .where(eq(databases.id, id))

    await agent.containerStart({ containerId: containerRes.containerId })
    await waitForDatabaseHealthy(containerRes.containerId, agent)
    if (publicEnabled && exposureMode === "public_proxy" && runtime.publicPort) {
      await caddy.upsertTcpProxy({
        serverId: tcpProxyServerId(id),
        listenPort: runtime.publicPort,
        upstream: `${host}:${tmpl.port}`,
      })
    }

    await updateConnectionSecrets(db, id, runtime.connectionString, creds.password)

    await db
      .update(databases)
      .set({
        status: "running",
        health_status: "healthy",
        last_started_at: new Date(),
      })
      .where(eq(databases.id, id))

    log.info({ id, kind, plan, host }, "database spawned")

    return { id, containerId: containerRes.containerId, connectionString: runtime.connectionString }
  } catch (err) {
    await db
      .update(databases)
      .set({
        status: "failed",
        health_status: "unhealthy",
      })
      .where(eq(databases.id, id))
    throw err
  }
}

export async function getConnectionString(row: DatabaseRow): Promise<string> {
  if (!row.connection_string_enc || !row.connection_string_nonce) {
    throw new Error("connection string not available")
  }
  return decryptSecret(row.connection_string_enc, row.connection_string_nonce)
}

export async function startDatabaseContainer(
  db: Db,
  row: DatabaseRow,
  opts: { ownerId: string },
): Promise<void> {
  if (!row.container_id) {
    await recreateDatabaseContainer(db, row, {
      exposureMode: row.exposure_mode as DbExposureMode,
      publicEnabled: row.public_enabled,
      ownerId: opts.ownerId,
    })
    return
  }
  const agent = getSharedAgent()
  try {
    await db
      .update(databases)
      .set({ status: "starting", health_status: "starting" })
      .where(eq(databases.id, row.id))
    await agent.containerStart({ containerId: row.container_id })
    await waitForDatabaseHealthy(row.container_id, agent)
    await db
      .update(databases)
      .set({ status: "running", health_status: "healthy", last_started_at: new Date() })
      .where(eq(databases.id, row.id))
  } catch (err) {
    await db
      .update(databases)
      .set({ status: "failed", health_status: "unhealthy" })
      .where(eq(databases.id, row.id))
    throw err
  }
}

export async function stopDatabaseContainer(db: Db, row: DatabaseRow): Promise<void> {
  if (!row.container_id) throw new Error("container not available")
  const agent = getSharedAgent()
  await agent.containerStop({ containerId: row.container_id, timeoutSeconds: 10 })
  await db
    .update(databases)
    .set({ status: "stopped", health_status: "unknown" })
    .where(eq(databases.id, row.id))
}

export async function recreateDatabaseContainer(
  db: Db,
  row: DatabaseRow,
  opts: RecreateOptions,
): Promise<DatabaseRow> {
  const agent = getSharedAgent()
  const caddy = getSharedCaddy()
  const creds =
    row.connection_string_enc && row.connection_string_nonce
      ? parseStoredConnectionString(
        row.kind as DbKind,
        await getConnectionString(row),
      )
      : (() => {
        const password = generatePassword()
        return getCredentials(
          row.kind as DbKind,
          resolveEnv(templates[row.kind as DbKind].env, password),
          resolveArgs(templates[row.kind as DbKind].args, password),
        )
      })()
  const host = hasValidAgentContainerName(row.host)
    ? row.host
    : containerName(row.id)
  const runtime = await buildRuntimeConfig(db, {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind as DbKind,
    plan: row.plan as DbPlan,
    volumeName: row.volume_name,
    host,
    creds,
    exposureMode: opts.exposureMode,
    publicEnabled: opts.publicEnabled,
  })
  const tmpl = templates[row.kind as DbKind]
  const networkName = await ensureProjectNetwork(db, row.project_id, agent)
  if (opts.publicEnabled && opts.exposureMode === "public_proxy") {
    await ensureCaddyOnProjectNetwork(agent, networkName)
  }
  const planCfg = tmpl.plans[row.plan as DbPlan]
  const memLimitBytes = BigInt(planCfg.mem_mb) * BigInt(1024 * 1024)

  if (row.container_id) {
    try {
      await agent.containerStop({ containerId: row.container_id, timeoutSeconds: 10 })
    } catch (err) {
      log.warn({ err, dbId: row.id }, "container stop warning during recreate")
    }
    await agent.containerRemove({ containerId: row.container_id, force: true, removeVolumes: false })
  }

  let containerId: string | null = null

  try {
    const containerRes = await agent.containerCreate({
      name: host,
      image: tmpl.image,
      env: runtime.env,
      command: runtime.args,
      networks: [networkName],
      network: networkName,
      volumes: [{ hostPath: `/var/lib/ploydok/volumes/${row.volume_name}`, containerPath: tmpl.volume_path, readOnly: false }],
      ports: runtime.ports,
      restartPolicy: "unless-stopped",
      resourceLimits: {
        cpu: planCfg.cpu,
        memoryBytes: Number(memLimitBytes),
        pidsLimit: 0,
      },
      healthcheck: buildDatabaseHealthcheck(tmpl.healthcheck),
      labels: databaseContainerLabels({
        dbId: row.id,
        ownerId: opts.ownerId,
        projectId: row.project_id,
      }),
      user: "",
    })
    containerId = containerRes.containerId

    await agent.containerStart({ containerId: containerRes.containerId })
    await waitForDatabaseHealthy(containerRes.containerId, agent)
    if (row.public_enabled && row.exposure_mode === "public_proxy" && row.public_port) {
      await caddy.removeTcpProxy(tcpProxyServerId(row.id))
    }
    if (opts.publicEnabled && opts.exposureMode === "public_proxy" && runtime.publicPort) {
      await caddy.upsertTcpProxy({
        serverId: tcpProxyServerId(row.id),
        listenPort: runtime.publicPort,
        upstream: `${host}:${tmpl.port}`,
      })
    }
    await updateConnectionSecrets(db, row.id, runtime.connectionString, creds.password)
    await db
      .update(databases)
      .set({
        container_id: containerRes.containerId,
        status: "running",
        health_status: "healthy",
        host,
        exposure_mode: opts.exposureMode,
        public_enabled: opts.publicEnabled,
        public_port: runtime.publicPort,
        public_host: runtime.publicHost,
        public_url: runtime.publicUrl,
        last_started_at: new Date(),
      })
      .where(eq(databases.id, row.id))

    return {
      ...row,
      container_id: containerRes.containerId,
      status: "running",
      health_status: "healthy",
      host,
      exposure_mode: opts.exposureMode,
      public_enabled: opts.publicEnabled,
      public_port: runtime.publicPort,
      public_host: runtime.publicHost,
      public_url: runtime.publicUrl,
      last_started_at: new Date(),
    }
  } catch (err) {
    await db
      .update(databases)
      .set({
        container_id: containerId,
        status: "failed",
        health_status: "unhealthy",
      })
      .where(eq(databases.id, row.id))
    throw err
  }
}

export async function removeDatabasePublicProxy(row: DatabaseRow): Promise<void> {
  if (!row.public_enabled || row.exposure_mode !== "public_proxy") return
  const caddy = getSharedCaddy()
  await caddy.removeTcpProxy(tcpProxyServerId(row.id))
}
