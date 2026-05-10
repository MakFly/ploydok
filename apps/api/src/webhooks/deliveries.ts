// SPDX-License-Identifier: AGPL-3.0-only
import { eq, and, gte, count } from "drizzle-orm"
import { nanoid } from "nanoid"
import { webhook_deliveries } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import type { DecisionEnum } from "./filters"

const MAX_REPLAYS_PER_DELIVERY = 10

export class ReplayLimitError extends Error {
  readonly code = "replay_limit_reached"
  constructor() {
    super("Replay limit reached (max 10 per delivery)")
  }
}

export class ReplayPayloadMissingError extends Error {
  readonly code = "replay_payload_missing"
  constructor() {
    super("Original payload_raw not available (expired or not stored)")
  }
}

const MAX_PAYLOAD_RAW_BYTES = 1024 * 1024 // 1 MB
const MAX_PAYLOAD_SAMPLE_BYTES = 4096 // 4 KB
const PAYLOAD_RAW_TTL_DAYS = 30
const DEDUP_WINDOW_SECONDS = 60

export interface InsertDeliveryRow {
  app_id?: string | null
  provider: "github" | "gitlab"
  delivery_external_id?: string | null
  event: string
  ref?: string | null
  commit_sha?: string | null
  commit_message?: string | null
  signature_valid: boolean
  decision: DecisionEnum
  decision_reason?: string | null
  build_id?: string | null
  payload_hash: string
  payload_raw?: Uint8Array | null
  payload_truncated?: boolean
  source?: "webhook" | "replay"
}

/**
 * Gzip-compress a Buffer.  Returns { data, truncated } — truncated=true when
 * the raw input exceeded MAX_PAYLOAD_RAW_BYTES (1 MB cap applied before compress).
 *
 * `data` is a Uint8Array (not a Bun Buffer) because postgres.js binds bytea
 * params via Buffer.byteLength on the raw value, and Bun's Buffer subclass
 * sometimes fails the binder's instanceof check while a plain Uint8Array
 * always works. The Drizzle customType toDriver doesn't run on this code
 * path under @drizzle/pg-core+postgres.js, so we coerce here.
 */
export async function compressPayload(raw: Buffer): Promise<{ data: Uint8Array; truncated: boolean }> {
  const truncated = raw.byteLength > MAX_PAYLOAD_RAW_BYTES
  const input = truncated ? raw.subarray(0, MAX_PAYLOAD_RAW_BYTES) : raw
  // Copy into a plain ArrayBuffer to satisfy strict Bun.gzipSync typing
  const ab = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer
  const compressed = Bun.gzipSync(new Uint8Array(ab))
  return { data: new Uint8Array(compressed), truncated }
}

/**
 * Truncate a JSON-serialisable value to at most MAX_PAYLOAD_SAMPLE_BYTES bytes
 * when serialised to JSON.  If it fits, returns the original value unchanged.
 */
export function truncateSample(value: unknown): unknown {
  const serialised = JSON.stringify(value)
  if (!serialised || serialised.length <= MAX_PAYLOAD_SAMPLE_BYTES) return value

  // Return a partial string slice (valid JSON string, not the original structure)
  return { _truncated: true, raw: serialised.slice(0, MAX_PAYLOAD_SAMPLE_BYTES) }
}

/**
 * Insert a delivery record.  Handles gzip + cap + sample truncation internally.
 * rawBodyBuffer is optional — omit for cases like invalid_signature where we
 * still want a record but may not have a parsed payload.
 */
export async function insertDelivery(
  db: Db,
  row: InsertDeliveryRow,
  rawBodyBuffer?: Buffer,
): Promise<string> {
  const id = nanoid()

  // TODO(payload_raw): postgres.js + Drizzle customType bytea binding crashes
  // under Bun ("Buffer.byteLength on Object") and aborts the whole webhook
  // handler before the BullMQ deploy enqueue. Skip audit storage of the raw
  // body for now — the webhook chain is more important than the replay
  // capability. We keep the payload_truncated flag honest for the size cap
  // assertion, just not the bytes themselves.
  const payloadRaw: Uint8Array | null = null
  let payloadTruncated = row.payload_truncated ?? false
  const payloadRawExpiresAt: Date | null = null

  if (rawBodyBuffer) {
    const { truncated } = await compressPayload(rawBodyBuffer)
    payloadTruncated = truncated
  }

  // Build a compact sample from the row's commit info (used for quick inspection)
  const sample = truncateSample({
    event: row.event,
    ref: row.ref,
    commit_sha: row.commit_sha,
    commit_message: row.commit_message,
  })

  await db.insert(webhook_deliveries).values({
    id,
    app_id: row.app_id ?? null,
    provider: row.provider,
    delivery_external_id: row.delivery_external_id ?? null,
    event: row.event,
    ref: row.ref ?? null,
    commit_sha: row.commit_sha ?? null,
    commit_message: row.commit_message ?? null,
    signature_valid: row.signature_valid,
    decision: row.decision,
    decision_reason: row.decision_reason ?? null,
    build_id: row.build_id ?? null,
    payload_hash: row.payload_hash,
    payload_sample: sample,
    payload_raw: payloadRaw,
    payload_raw_expires_at: payloadRawExpiresAt,
    payload_truncated: payloadTruncated,
    source: row.source ?? "webhook",
    processed_at: new Date(),
  })

  return id
}

/**
 * Look up a recent delivery by payload hash within the dedup window.
 * Returns the first match or null if none found.
 */
export async function findRecentByPayloadHash(
  db: Db,
  hash: string,
  withinSeconds = DEDUP_WINDOW_SECONDS,
): Promise<{ id: string; decision: DecisionEnum } | null> {
  const since = new Date(Date.now() - withinSeconds * 1000)
  const rows = await db
    .select({ id: webhook_deliveries.id, decision: webhook_deliveries.decision })
    .from(webhook_deliveries)
    .where(
      and(
        eq(webhook_deliveries.payload_hash, hash),
        gte(webhook_deliveries.received_at, since),
      ),
    )
    .limit(1)

  return rows[0] ?? null
}

/**
 * Mark an existing delivery as coalesced (superseded by a newer enqueue).
 */
export async function markDeliveryCoalesced(db: Db, deliveryId: string): Promise<void> {
  await db
    .update(webhook_deliveries)
    .set({ decision: "coalesced" })
    .where(eq(webhook_deliveries.id, deliveryId))
}

/**
 * Replay a webhook delivery by loading its stored payload_raw, decompressing it,
 * and re-calling handlePushGeneric. Anti-abuse: max 10 replays per parent delivery.
 *
 * Returns the new deliveryId created by the replay.
 */
export async function replayDelivery(
  db: Db,
  deliveryId: string,
  appId: string,
): Promise<string> {
  // Load the original delivery row
  const rows = await db
    .select({
      id: webhook_deliveries.id,
      app_id: webhook_deliveries.app_id,
      provider: webhook_deliveries.provider,
      event: webhook_deliveries.event,
      ref: webhook_deliveries.ref,
      commit_sha: webhook_deliveries.commit_sha,
      commit_message: webhook_deliveries.commit_message,
      payload_raw: webhook_deliveries.payload_raw,
      payload_hash: webhook_deliveries.payload_hash,
    })
    .from(webhook_deliveries)
    .where(
      and(
        eq(webhook_deliveries.id, deliveryId),
        eq(webhook_deliveries.app_id, appId),
      ),
    )
    .limit(1)

  const row = rows[0]
  if (!row) {
    throw new Error("Delivery not found")
  }

  if (!row.payload_raw) {
    throw new ReplayPayloadMissingError()
  }

  // Count existing replays for this parent delivery
  const countRows = await db
    .select({ c: count() })
    .from(webhook_deliveries)
    .where(eq(webhook_deliveries.parent_delivery_id, deliveryId))

  const replayCount = Number(countRows[0]?.c ?? 0)
  if (replayCount >= MAX_REPLAYS_PER_DELIVERY) {
    throw new ReplayLimitError()
  }

  // Decompress gzip payload
  const decompressed = Bun.gunzipSync(new Uint8Array(row.payload_raw))
  const rawBody = Buffer.from(decompressed)

  // Dynamically import handlePushGeneric to avoid circular deps at module load time
  const { handlePushGeneric } = await import("../webhook-handlers/push")

  // Parse the stored JSON to reconstruct the event
  const payloadJson = JSON.parse(rawBody.toString("utf-8")) as Record<string, unknown>

  // Build a ParsedPushEvent-compatible object from stored fields
  const event = {
    provider: row.provider as "github" | "gitlab",
    repoFullName: (payloadJson.repository as { full_name?: string } | undefined)?.full_name ?? "",
    branch: row.ref ?? "",
    commitSha: row.commit_sha ?? "",
    commitMessage: row.commit_message ?? "",
    authRef: (payloadJson.installation as { id?: number } | undefined)?.id?.toString()
      ?? (payloadJson.user_id as string | undefined)
      ?? "",
    payloadHash: row.payload_hash,
    rawBody,
  }

  const newDeliveryId = nanoid()

  // Insert replay delivery record before calling handler so handler can reference it
  await db.insert(webhook_deliveries).values({
    id: newDeliveryId,
    app_id: appId,
    provider: row.provider,
    event: row.event,
    ref: row.ref,
    commit_sha: row.commit_sha,
    commit_message: row.commit_message,
    signature_valid: true,
    decision: "enqueued",
    decision_reason: "replay",
    payload_hash: row.payload_hash,
    payload_sample: null,
    payload_raw: null,
    payload_raw_expires_at: null,
    payload_truncated: false,
    source: "replay",
    parent_delivery_id: deliveryId,
    processed_at: new Date(),
  })

  // Re-run the push handler with the decoded payload — filters re-apply automatically
  await handlePushGeneric(db, event, newDeliveryId)

  return newDeliveryId
}
