// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto"
import { nanoid } from "nanoid"
import { eq } from "drizzle-orm"
import { app_db_links, apps, secrets } from "@ploydok/db"
import type { Db, ResourceCreationSagaRow } from "@ploydok/db"
import {
  completeClaimedCreationSagaCompensation,
  recordClaimedCreationSagaStep,
} from "@ploydok/db/queries"
import { decryptSecret, encryptSecret } from "../secrets/crypto"

interface ApplicationCreationInput {
  initialSecrets: Array<{
    key: string
    value: string
    scope: "shared" | "prod" | "preview"
    phase: "build" | "runtime" | "both"
  }>
  databaseVars: Record<string, string> | null
  databaseId: string | null
  databaseEnvPrefix: string | null
}

export async function compensateApplicationCreation(
  db: Db,
  saga: ResourceCreationSagaRow,
  token: string,
  reason: string
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(secrets).where(eq(secrets.app_id, saga.resource_id))
    await tx
      .delete(app_db_links)
      .where(eq(app_db_links.app_id, saga.resource_id))
    await tx
      .update(apps)
      .set({ status: "failed", updated_at: new Date() })
      .where(eq(apps.id, saga.resource_id))
    if (
      !(await completeClaimedCreationSagaCompensation(
        tx,
        "application",
        saga.resource_id,
        token,
        reason
      ))
    ) {
      throw new Error("application creation compensation lease lost")
    }
  })
}

export async function resumeApplicationConfiguration(
  db: Db,
  saga: ResourceCreationSagaRow,
  token: string
): Promise<void> {
  if (saga.completed_steps.includes("configuration_persisted")) return
  if (!saga.input_ciphertext || !saga.input_nonce || !saga.input_digest) {
    throw new Error("application creation saga has no immutable resume input")
  }
  const plaintext = await decryptSecret(saga.input_ciphertext, saga.input_nonce)
  const digest = createHash("sha256").update(plaintext).digest("hex")
  if (digest !== saga.input_digest) {
    throw new Error("application creation saga input digest mismatch")
  }
  const input = JSON.parse(plaintext) as ApplicationCreationInput
  if (!Array.isArray(input.initialSecrets)) {
    throw new Error("application creation saga input is invalid")
  }
  const encryptedSecrets = await Promise.all(
    input.initialSecrets.map(async (item) => ({
      ...item,
      ...(await encryptSecret(item.value)),
    }))
  )
  const encryptedDatabaseVars = await Promise.all(
    Object.entries(input.databaseVars ?? {}).map(async ([key, value]) => ({
      key,
      ...(await encryptSecret(value)),
    }))
  )
  const now = new Date()
  await db.transaction(async (tx) => {
    await tx.delete(secrets).where(eq(secrets.app_id, saga.resource_id))
    await tx
      .delete(app_db_links)
      .where(eq(app_db_links.app_id, saga.resource_id))
    for (const item of encryptedSecrets) {
      await tx.insert(secrets).values({
        id: nanoid(),
        app_id: saga.resource_id,
        project_id: saga.project_id,
        scope: item.scope,
        phase: item.phase,
        key: item.key,
        value_ciphertext: item.enc,
        nonce: item.nonce,
        created_at: now,
      })
    }
    if (input.databaseId && input.databaseEnvPrefix) {
      for (const item of encryptedDatabaseVars) {
        await tx.insert(secrets).values({
          id: nanoid(),
          app_id: saga.resource_id,
          project_id: saga.project_id,
          scope: "shared",
          phase: "runtime",
          key: item.key,
          value_ciphertext: item.enc,
          nonce: item.nonce,
          linked_database_id: input.databaseId,
          created_at: now,
        })
      }
      await tx.insert(app_db_links).values({
        id: nanoid(),
        app_id: saga.resource_id,
        database_id: input.databaseId,
        env_prefix: input.databaseEnvPrefix,
        created_at: now,
      })
    }
    const recorded = await recordClaimedCreationSagaStep(
      tx,
      "application",
      saga.resource_id,
      token,
      "configuration_persisted"
    )
    if (!recorded) throw new Error("application creation saga lease lost")
  })
}
