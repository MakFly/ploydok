// SPDX-License-Identifier: AGPL-3.0-only
import { readFile } from "node:fs/promises"
import postgres from "postgres"

// `POSTGRES_PASSWORD` n'est honoré qu'au premier initdb. Si le volume
// postgres-data survit à une rotation de PLOYDOK_PG_PASSWORD, le hash SCRAM
// stocké dans pg_authid reste sur l'ancienne valeur et toute connexion TCP
// échoue en 28P01. Ce script réconcilie le rôle avec .env.local.

const ENV_FILE = "apps/api/.env.local"
const COMPOSE_FILE = "infra/docker-compose.yml"
const SERVICE = "postgres"
const ROLE = "ploydok"
const INVALID_PASSWORD = "28P01"
const READY_TIMEOUT_MS = 30_000
const RETRY_DELAY_MS = 1_000

type ProbeResult = "ok" | "invalid-password"

function fail(message: string): never {
  console.error(`[db-auth] ${message}`)
  process.exit(1)
}

async function readEnvFile(): Promise<Map<string, string>> {
  const entries = new Map<string, string>()
  let content: string
  try {
    content = await readFile(ENV_FILE, "utf8")
  } catch {
    fail(`${ENV_FILE} not found — run 'make secrets-init' first`)
  }

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const separator = line.indexOf("=")
    if (separator <= 0) continue
    const key = line.slice(0, separator)
    const value = line.slice(separator + 1).replace(/^["']|["']$/g, "")
    entries.set(key, value)
  }

  return entries
}

function maskUrl(url: string): string {
  return url.replace(/:\/\/([^:/@]+):[^@]*@/, "://$1:***@")
}

function passwordFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.password ? decodeURIComponent(parsed.password) : null
  } catch {
    return null
  }
}

async function probe(url: string): Promise<ProbeResult> {
  const sql = postgres(url, {
    max: 1,
    connect_timeout: 5,
    idle_timeout: 1,
    onnotice: () => {},
  })
  try {
    await sql`select 1`
    return "ok"
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === INVALID_PASSWORD) return "invalid-password"
    throw error
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {})
  }
}

async function probeUntilReachable(url: string): Promise<ProbeResult> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  let lastError: unknown

  while (Date.now() < deadline) {
    try {
      return await probe(url)
    } catch (error) {
      lastError = error
      await Bun.sleep(RETRY_DELAY_MS)
    }
  }

  const detail =
    lastError instanceof Error ? lastError.message : String(lastError)
  fail(
    `postgres unreachable at ${maskUrl(url)} after ${READY_TIMEOUT_MS / 1000}s: ${detail}`
  )
}

async function composeServiceRunning(): Promise<boolean> {
  const proc = Bun.spawn(
    [
      "docker",
      "compose",
      "--env-file",
      ENV_FILE,
      "-f",
      COMPOSE_FILE,
      "ps",
      "-q",
      SERVICE,
    ],
    { stdout: "pipe", stderr: "ignore" }
  )
  const containerId = (await new Response(proc.stdout).text()).trim()
  await proc.exited
  return containerId.length > 0
}

async function resetRolePassword(password: string): Promise<void> {
  const literal = password.replaceAll("'", "''")
  const proc = Bun.spawn(
    [
      "docker",
      "compose",
      "--env-file",
      ENV_FILE,
      "-f",
      COMPOSE_FILE,
      "exec",
      "-T",
      SERVICE,
      "psql",
      "-U",
      ROLE,
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "--quiet",
      "-f",
      "-",
    ],
    {
      // Le secret transite par stdin : jamais en argv, jamais dans
      // `docker inspect`, jamais dans l'historique shell.
      stdin: new TextEncoder().encode(
        `ALTER ROLE "${ROLE}" WITH PASSWORD '${literal}';\n`
      ),
      stdout: "ignore",
      stderr: "pipe",
    }
  )
  const stderr = (await new Response(proc.stderr).text()).trim()
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    fail(`failed to reset role "${ROLE}" password: ${stderr || "psql error"}`)
  }
}

const env = await readEnvFile()
const databaseUrl = env.get("DATABASE_URL")
if (!databaseUrl) fail(`DATABASE_URL missing from ${ENV_FILE}`)

const initial = await probeUntilReachable(databaseUrl)
if (initial === "ok") {
  console.log("[db-auth] postgres authentication ok")
  process.exit(0)
}

console.log(
  `[db-auth] password mismatch on role "${ROLE}" — the postgres volume predates the current PLOYDOK_PG_PASSWORD`
)

const declaredPassword = env.get("PLOYDOK_PG_PASSWORD")
const urlPassword = passwordFromUrl(databaseUrl)
if (!declaredPassword || !urlPassword) {
  fail(
    `cannot repair: PLOYDOK_PG_PASSWORD or the DATABASE_URL password is missing from ${ENV_FILE}`
  )
}
if (declaredPassword !== urlPassword) {
  fail(
    `cannot repair: PLOYDOK_PG_PASSWORD and the DATABASE_URL password differ in ${ENV_FILE} — fix the file first`
  )
}

if (!(await composeServiceRunning())) {
  fail(
    `compose service "${SERVICE}" is not running — run 'make infra-up' before repairing`
  )
}

console.log(`[db-auth] realigning role "${ROLE}" with ${ENV_FILE}...`)
await resetRolePassword(declaredPassword)

if ((await probe(databaseUrl)) !== "ok") {
  fail("repair applied but authentication still fails — inspect the container")
}

console.log("[db-auth] role realigned, authentication ok (data preserved)")
