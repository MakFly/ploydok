// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from "node:crypto"
import { nanoid } from "nanoid"
import { databases } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { eq } from "drizzle-orm"
import { childLogger } from "../logger"
import { encryptSecret, decryptSecret } from "../secrets/crypto"
import { ensureProjectNetwork } from "../projects"
import { getSharedAgent } from "../debug/singletons"
import { templates } from "./templates/index"
import type { DatabaseRow } from "@ploydok/db"

const log = childLogger("databases.spawner")

export type DbKind = "postgres" | "redis" | "mongo"
export type DbPlan = "small" | "medium" | "large"

interface SpawnOptions {
  projectId: string
  kind: DbKind
  name: string
  plan: DbPlan
}

interface SpawnResult {
  id: string
  containerId: string
  connectionString: string
}

function generatePassword(): string {
  return randomBytes(24).toString("base64url")
}

function containerName(dbId: string): string {
  return `ploydok-db-${dbId}`
}

function volumeName(dbId: string): string {
  return `ploydok-db-${dbId}`
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

export async function spawnDatabase(db: Db, opts: SpawnOptions): Promise<SpawnResult> {
  const { projectId, kind, name, plan } = opts
  const tmpl = templates[kind]
  const planCfg = tmpl.plans[plan]

  const id = nanoid()
  const password = generatePassword()
  const resolvedEnv = resolveEnv(tmpl.env, password)
  const resolvedArgs = resolveArgs(tmpl.args, password)
  const creds = getCredentials(kind, resolvedEnv, resolvedArgs)
  const host = containerName(id)
  const vol = volumeName(id)

  const connString = buildConnectionString(tmpl.connection_string, {
    user: creds.user,
    password: creds.password,
    host,
    port: tmpl.port,
    database: creds.database,
  })

  await db.insert(databases).values({
    id,
    project_id: projectId,
    kind,
    name,
    plan,
    volume_name: vol,
    status: "creating",
    host,
    port: tmpl.port,
  })

  const agent = getSharedAgent()

  const networkName = await ensureProjectNetwork(db, projectId, agent)

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
    env: resolvedEnv,
    command: resolvedArgs,
    networks: [networkName],
    network: networkName,
    volumes: [{ hostPath: `/var/lib/ploydok/volumes/${vol}`, containerPath: tmpl.volume_path, readOnly: false }],
    ports: [],
    restartPolicy: "unless-stopped",
    resourceLimits: {
      cpu: planCfg.cpu,
      memoryBytes: Number(memLimitBytes),
      pidsLimit: 0,
    },
    labels: {
      "ploydok.kind": "database",
      "ploydok.db_id": id,
      "ploydok.project_id": projectId,
    },
    user: "",
  })

  const { enc: connEnc, nonce: connNonce } = await encryptSecret(connString)
  const { enc: pwEnc, nonce: pwNonce } = await encryptSecret(creds.password)

  await db
    .update(databases)
    .set({
      container_id: containerRes.containerId,
      status: "running",
      connection_string_enc: connEnc,
      connection_string_nonce: connNonce,
      master_password_enc: pwEnc,
      master_password_nonce: pwNonce,
    })
    .where(eq(databases.id, id))

  log.info({ id, kind, plan, host }, "database spawned")

  return { id, containerId: containerRes.containerId, connectionString: connString }
}

export async function getConnectionString(row: DatabaseRow): Promise<string> {
  if (!row.connection_string_enc || !row.connection_string_nonce) {
    throw new Error("connection string not available")
  }
  return decryptSecret(row.connection_string_enc, row.connection_string_nonce)
}
