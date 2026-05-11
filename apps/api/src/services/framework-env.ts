// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from "node:crypto"
import { eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { env_vars, secrets } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import type { StackClassification } from "@ploydok/shared"
import { frameworkGuardrailDefaults } from "@ploydok/shared"
import { decryptSecret, encryptSecret } from "../secrets/crypto"

export function generateLaravelAppKey(): string {
  return `base64:${randomBytes(32).toString("base64")}`
}

function generateFrameworkSecret(): string {
  return randomBytes(32).toString("hex")
}

export function suggestedEnvForFramework(
  classification: StackClassification
): Record<string, string> {
  const suggested = {
    ...frameworkGuardrailDefaults(classification).defaults.suggestedEnvVars,
  }
  if (classification.stack === "laravel") {
    suggested.APP_KEY = generateLaravelAppKey()
    suggested.APP_ENV = "production"
    suggested.APP_DEBUG = "false"
    suggested.LOG_CHANNEL = "stderr"
    suggested.QUEUE_CONNECTION = "sync"
  }
  if (classification.stack === "symfony") {
    suggested.APP_SECRET = generateFrameworkSecret()
    suggested.APP_ENV = "prod"
    suggested.APP_DEBUG = "0"
  }
  if (classification.stack === "ruby" && classification.framework === "Rails") {
    suggested.SECRET_KEY_BASE = generateFrameworkSecret()
  }
  if (
    classification.stack === "elixir" &&
    classification.framework === "Phoenix"
  ) {
    suggested.SECRET_KEY_BASE = generateFrameworkSecret()
  }
  return suggested
}

function phaseForFrameworkEnvKey(key: string): "build" | "runtime" | "both" {
  if (key.startsWith("NIXPACKS_")) return "build"
  if (
    key.startsWith("NEXT_PUBLIC_") ||
    key.startsWith("PUBLIC_") ||
    key.startsWith("VITE_") ||
    key.startsWith("ASTRO_")
  ) {
    return "both"
  }
  return "runtime"
}

const LARAVEL_ZERO_CONFIG_DRIVER_KEYS = new Set([
  "SESSION_DRIVER",
  "CACHE_STORE",
])

const EXTERNAL_DATABASE_SIGNAL_KEYS = [
  "DATABASE_URL",
  "DB_URL",
  "DB_HOST",
  "DB_DATABASE",
  "DB_USERNAME",
  "DB_PASSWORD",
]

export function sanitizeLaravelEnvValues(
  input: Record<string, string>
): { values: Record<string, string>; repaired: string[] } {
  const values = { ...input }
  const repaired: string[] = []
  const appKey = values.APP_KEY
  if (appKey !== undefined && appKey.trim() === "") {
    values.APP_KEY = generateLaravelAppKey()
    repaired.push("APP_KEY")
  }

  const dbConnection = values.DB_CONNECTION?.trim().toLowerCase()
  const hasExternalDatabaseSignal = EXTERNAL_DATABASE_SIGNAL_KEYS.some(
    (key) => {
      const value = values[key]?.trim()
      return value !== undefined && value !== "" && key !== "DB_CONNECTION"
    }
  )
  const isZeroConfigSqlite =
    !hasExternalDatabaseSignal &&
    (dbConnection === undefined || dbConnection === "" || dbConnection === "sqlite")

  if (isZeroConfigSqlite) {
    for (const key of LARAVEL_ZERO_CONFIG_DRIVER_KEYS) {
      if (values[key]?.trim().toLowerCase() === "database") {
        values[key] = "file"
        repaired.push(key)
      }
    }
  }

  return { values, repaired }
}

export function sanitizeFrameworkEnvValues(
  classification: StackClassification | null,
  input: Record<string, string>
): { values: Record<string, string>; repaired: string[]; warnings: string[] } {
  let values = { ...input }
  const repaired: string[] = []
  const warnings: string[] = []

  const looksLaravel =
    classification?.stack === "laravel" ||
    values.APP_KEY !== undefined ||
    values.ARTISAN_ENV !== undefined
  if (looksLaravel) {
    const result = sanitizeLaravelEnvValues(values)
    values = result.values
    repaired.push(...result.repaired)
    if (values.APP_DEBUG?.trim().toLowerCase() === "true") {
      warnings.push("Laravel APP_DEBUG=true should be disabled in production")
    }
  }

  if (classification?.stack === "symfony" || values.APP_SECRET !== undefined) {
    if (values.APP_SECRET !== undefined && values.APP_SECRET.trim() === "") {
      values.APP_SECRET = generateFrameworkSecret()
      repaired.push("APP_SECRET")
    }
    if (values.APP_DEBUG?.trim() === "1") {
      warnings.push("Symfony APP_DEBUG=1 should be disabled in production")
    }
  }

  const needsSecretKeyBase =
    (classification?.stack === "ruby" && classification.framework === "Rails") ||
    (classification?.stack === "elixir" &&
      classification.framework === "Phoenix")
  if (
    (needsSecretKeyBase || values.SECRET_KEY_BASE !== undefined) &&
    values.SECRET_KEY_BASE !== undefined &&
    values.SECRET_KEY_BASE.trim() === ""
  ) {
    values.SECRET_KEY_BASE = generateFrameworkSecret()
    repaired.push("SECRET_KEY_BASE")
  }

  return { values, repaired: [...new Set(repaired)], warnings }
}

function isProblematicFrameworkEnvValue(
  classification: StackClassification,
  key: string,
  value: string,
  sanitized: Record<string, string>
): boolean {
  if (
    (key === "APP_KEY" ||
      key === "APP_SECRET" ||
      key === "SECRET_KEY_BASE") &&
    value.trim() === ""
  ) {
    return true
  }
  if (classification.stack !== "laravel") return false
  if (!LARAVEL_ZERO_CONFIG_DRIVER_KEYS.has(key)) return false
  return value.trim().toLowerCase() === "database" && sanitized[key] === "file"
}

export function assertDeployableFrameworkEnv(
  classification: StackClassification,
  env: Record<string, string>
): void {
  if (classification.stack === "laravel" && !env.APP_KEY?.trim()) {
    throw new Error("Laravel APP_KEY is empty after framework env preparation")
  }
  if (classification.stack === "symfony" && !env.APP_SECRET?.trim()) {
    throw new Error("Symfony APP_SECRET is empty after framework env preparation")
  }
  if (
    classification.stack === "ruby" &&
    classification.framework === "Rails" &&
    !env.SECRET_KEY_BASE?.trim()
  ) {
    throw new Error("Rails SECRET_KEY_BASE is empty after framework env preparation")
  }
  if (
    classification.stack === "elixir" &&
    classification.framework === "Phoenix" &&
    !env.SECRET_KEY_BASE?.trim()
  ) {
    throw new Error(
      "Phoenix SECRET_KEY_BASE is empty after framework env preparation"
    )
  }
}

export async function ensureFrameworkEnvVars(params: {
  db: Db
  appId: string
  projectId: string
  classification: StackClassification
}): Promise<{ injected: string[]; skipped: string[]; repaired: string[] }> {
  const suggested = suggestedEnvForFramework(params.classification)
  if (Object.keys(suggested).length === 0) {
    return { injected: [], skipped: [], repaired: [] }
  }

  const [secretRows, envRows] = await Promise.all([
    params.db
      .select({
        id: secrets.id,
        key: secrets.key,
        phase: secrets.phase,
        value_ciphertext: secrets.value_ciphertext,
        nonce: secrets.nonce,
        linked_database_id: secrets.linked_database_id,
      })
      .from(secrets)
      .where(eq(secrets.app_id, params.appId)),
    params.db
      .select({ id: env_vars.id, key: env_vars.key, value: env_vars.value })
      .from(env_vars)
      .where(eq(env_vars.app_id, params.appId)),
  ])

  const existingKeys = new Set([
    ...secretRows.map((row) => row.key),
    ...envRows.map((row) => row.key),
  ])
  const injected: string[] = []
  const skipped: string[] = []
  const repaired: string[] = []
  const decryptedSecretRows = await Promise.all(
    secretRows.map(async (row) => ({
      ...row,
      value: await decryptSecret(
        row.value_ciphertext as Buffer,
        row.nonce as Buffer
      ),
    }))
  )
  const currentValues = Object.fromEntries(
    decryptedSecretRows.map((row) => [row.key, row.value])
  )
  for (const row of envRows) currentValues[row.key] = row.value
  const sanitized = sanitizeFrameworkEnvValues(
    params.classification,
    currentValues
  ).values

  for (const [key, value] of Object.entries(suggested)) {
    const phase = phaseForFrameworkEnvKey(key)
    const preparedValue = sanitized[key] ?? value
    if (existingKeys.has(key)) {
      const secretRow = secretRows.find((row) => row.key === key)
      const envRow = envRows.find((row) => row.key === key)
      if (secretRow && secretRow.phase !== phase) {
        await params.db
          .update(secrets)
          .set({ phase })
          .where(eq(secrets.id, secretRow.id))
      }

      {
        if (envRow && isProblematicFrameworkEnvValue(params.classification, key, envRow.value, sanitized)) {
          await params.db
            .update(env_vars)
            .set({ value: preparedValue, updated_at: new Date() })
            .where(eq(env_vars.id, envRow.id))
          repaired.push(key)
          continue
        }

        if (!envRow) {
          const repairableSecretRows = decryptedSecretRows.filter(
            (row) =>
              row.key === key &&
              isProblematicFrameworkEnvValue(
                params.classification,
                key,
                row.value,
                sanitized
              )
          )
          if (repairableSecretRows.length > 0) {
            for (const row of repairableSecretRows) {
              const { enc, nonce } = await encryptSecret(preparedValue)
              await params.db
                .update(secrets)
                .set({ value_ciphertext: enc, nonce })
                .where(eq(secrets.id, row.id))
            }
            repaired.push(key)
            continue
          }
        }
      }
      skipped.push(key)
      continue
    }
    const { enc, nonce } = await encryptSecret(preparedValue)
    await params.db.insert(secrets).values({
      id: nanoid(),
      app_id: params.appId,
      project_id: params.projectId,
      scope: "shared",
      phase,
      key,
      value_ciphertext: enc,
      nonce,
      created_at: new Date(),
    })
    existingKeys.add(key)
    injected.push(key)
  }

  return { injected, skipped, repaired }
}
