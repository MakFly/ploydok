// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from "node:crypto"
import { eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { env_vars, secrets } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import type { StackClassification } from "@ploydok/shared"
import { encryptSecret } from "../secrets/crypto"

export function generateLaravelAppKey(): string {
  return `base64:${randomBytes(32).toString("base64")}`
}

export function suggestedEnvForFramework(
  classification: StackClassification
): Record<string, string> {
  const suggested = { ...classification.suggestedEnvVars }
  if (classification.stack === "laravel") {
    suggested.APP_KEY = generateLaravelAppKey()
  }
  return suggested
}

function phaseForFrameworkEnvKey(key: string): "build" | "runtime" | "both" {
  if (key.startsWith("NIXPACKS_")) return "build"
  return "runtime"
}

export async function ensureFrameworkEnvVars(params: {
  db: Db
  appId: string
  projectId: string
  classification: StackClassification
}): Promise<{ injected: string[]; skipped: string[] }> {
  const suggested = suggestedEnvForFramework(params.classification)
  if (Object.keys(suggested).length === 0) {
    return { injected: [], skipped: [] }
  }

  const [secretRows, envRows] = await Promise.all([
    params.db
      .select({ id: secrets.id, key: secrets.key, phase: secrets.phase })
      .from(secrets)
      .where(eq(secrets.app_id, params.appId)),
    params.db
      .select({ key: env_vars.key })
      .from(env_vars)
      .where(eq(env_vars.app_id, params.appId)),
  ])

  const existingKeys = new Set([
    ...secretRows.map((row) => row.key),
    ...envRows.map((row) => row.key),
  ])
  const injected: string[] = []
  const skipped: string[] = []

  for (const [key, value] of Object.entries(suggested)) {
    const phase = phaseForFrameworkEnvKey(key)
    if (existingKeys.has(key)) {
      const secretRow = secretRows.find((row) => row.key === key)
      if (secretRow && secretRow.phase !== phase) {
        await params.db
          .update(secrets)
          .set({ phase })
          .where(eq(secrets.id, secretRow.id))
      }
      skipped.push(key)
      continue
    }
    const { enc, nonce } = await encryptSecret(value)
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

  return { injected, skipped }
}
