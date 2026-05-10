// SPDX-License-Identifier: AGPL-3.0-only
import { apiFetch } from "./api"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DeliveryDecision =
  | "enqueued"
  | "skipped_disabled"
  | "skipped_branch"
  | "skipped_path"
  | "skipped_directive"
  | "skipped_unknown_app"
  | "skipped_tag_disabled"
  | "skipped_tag_pattern"
  | "invalid_signature"
  | "error"
  | "coalesced"
  | "retried"

export interface WebhookDelivery {
  id: string
  appId?: string | null
  provider: "github" | "gitlab"
  deliveryExternalId?: string | null
  event: string
  ref?: string | null
  commitSha?: string | null
  commitMessage?: string | null
  signatureValid: boolean
  decision: DeliveryDecision
  decisionReason?: string | null
  buildId?: string | null
  payloadSample?: unknown
  source: "webhook" | "replay"
  retryCount: number
  receivedAt: string
  processedAt?: string | null
  parentDeliveryId?: string | null
}

export interface DeliveriesPage {
  deliveries: Array<WebhookDelivery>
  nextCursor?: string
}

interface RawWebhookDelivery {
  id: string
  app_id?: string | null
  provider: "github" | "gitlab"
  delivery_external_id?: string | null
  event: string
  ref?: string | null
  commit_sha?: string | null
  commit_message?: string | null
  signature_valid: boolean
  decision: DeliveryDecision
  decision_reason?: string | null
  build_id?: string | null
  payload_sample?: unknown
  source: "webhook" | "replay"
  retry_count: number
  received_at: string
  processed_at?: string | null
  parent_delivery_id?: string | null
}

interface RawDeliveriesPage {
  deliveries: Array<RawWebhookDelivery>
  next_cursor: string | null
}

interface RawDeliveryDetailsResponse {
  delivery: RawWebhookDelivery
}

export interface AutoDeploySettings {
  autoDeployEnabled: boolean
  postCommitStatus: boolean
  coalescePushes: boolean
  deployOnTag: boolean
  tagPattern?: string
}

export interface RotateSecretResult {
  secret: string
}

export interface WebhookSecretInfo {
  hasSecret: boolean
  lastRotatedAt?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function mapDelivery(raw: RawWebhookDelivery): WebhookDelivery {
  return {
    id: raw.id,
    appId: raw.app_id,
    provider: raw.provider,
    deliveryExternalId: raw.delivery_external_id,
    event: raw.event,
    ref: raw.ref,
    commitSha: raw.commit_sha,
    commitMessage: raw.commit_message,
    signatureValid: raw.signature_valid,
    decision: raw.decision,
    decisionReason: raw.decision_reason,
    buildId: raw.build_id,
    payloadSample: raw.payload_sample,
    source: raw.source,
    retryCount: raw.retry_count,
    receivedAt: raw.received_at,
    processedAt: raw.processed_at,
    parentDeliveryId: raw.parent_delivery_id,
  }
}

export function mapDeliveriesPage(raw: RawDeliveriesPage): DeliveriesPage {
  return {
    deliveries: raw.deliveries.map(mapDelivery),
    nextCursor: raw.next_cursor ?? undefined,
  }
}

export async function listDeliveries(
  appId: string,
  cursor?: string
): Promise<DeliveriesPage> {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""
  const data = await apiFetch<RawDeliveriesPage>(
    `/apps/${appId}/webhook-deliveries${qs}`
  )
  return mapDeliveriesPage(data)
}

export async function getDeliveryDetails(
  appId: string,
  deliveryId: string
): Promise<WebhookDelivery> {
  const data = await apiFetch<RawDeliveryDetailsResponse>(
    `/apps/${appId}/webhook-deliveries/${deliveryId}`
  )
  return mapDelivery(data.delivery)
}

export async function rotateWebhookSecret(
  appId: string,
  totpCode: string
): Promise<RotateSecretResult> {
  return apiFetch<RotateSecretResult>(`/apps/${appId}/webhook-secret/rotate`, {
    method: "POST",
    headers: { "X-TOTP-Code": totpCode },
  })
}

export interface ReplayDeliveryResult {
  delivery_id: string
}

export async function replayDelivery(
  appId: string,
  deliveryId: string,
  totpCode: string
): Promise<ReplayDeliveryResult> {
  return apiFetch<ReplayDeliveryResult>(
    `/apps/${appId}/webhook-deliveries/${deliveryId}/replay`,
    {
      method: "POST",
      headers: { "X-TOTP-Code": totpCode },
    }
  )
}

export async function patchAppSettings(
  appId: string,
  patch: Partial<AutoDeploySettings>
): Promise<void> {
  const body: Record<string, unknown> = {}
  if (patch.autoDeployEnabled !== undefined)
    body.auto_deploy_enabled = patch.autoDeployEnabled
  if (patch.postCommitStatus !== undefined)
    body.post_commit_status = patch.postCommitStatus
  if (patch.coalescePushes !== undefined)
    body.coalesce_pushes = patch.coalescePushes
  if (patch.deployOnTag !== undefined) body.deploy_on_tag = patch.deployOnTag
  if (patch.tagPattern !== undefined) body.tag_pattern = patch.tagPattern
  await apiFetch(`/apps/${appId}`, { method: "PATCH", body })
}
