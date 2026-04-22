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
  | "invalid_signature"
  | "error"
  | "coalesced"
  | "retried"

export interface WebhookDelivery {
  id: string
  appId: string
  provider: "github" | "gitlab"
  deliveryExternalId?: string
  event: string
  ref?: string
  commitSha?: string
  commitMessage?: string
  signatureValid: boolean
  decision: DeliveryDecision
  decisionReason?: string
  buildId?: string
  payloadSample?: unknown
  source: "webhook" | "replay"
  retryCount: number
  receivedAt: string
  processedAt?: string
}

export interface DeliveriesPage {
  deliveries: Array<WebhookDelivery>
  nextCursor?: string
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

export async function listDeliveries(
  appId: string,
  cursor?: string,
): Promise<DeliveriesPage> {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""
  return apiFetch<DeliveriesPage>(`/apps/${appId}/webhook-deliveries${qs}`)
}

export async function getDeliveryDetails(
  appId: string,
  deliveryId: string,
): Promise<WebhookDelivery> {
  return apiFetch<WebhookDelivery>(
    `/apps/${appId}/webhook-deliveries/${deliveryId}`,
  )
}

export async function rotateWebhookSecret(
  appId: string,
  totpCode: string,
): Promise<RotateSecretResult> {
  return apiFetch<RotateSecretResult>(
    `/apps/${appId}/webhook-secret/rotate`,
    {
      method: "POST",
      headers: { "X-TOTP-Code": totpCode },
    },
  )
}

export interface ReplayDeliveryResult {
  delivery_id: string
}

export async function replayDelivery(
  appId: string,
  deliveryId: string,
  totpCode: string,
): Promise<ReplayDeliveryResult> {
  return apiFetch<ReplayDeliveryResult>(
    `/apps/${appId}/webhook-deliveries/${deliveryId}/replay`,
    {
      method: "POST",
      headers: { "X-TOTP-Code": totpCode },
    },
  )
}

export async function patchAppSettings(
  appId: string,
  patch: Partial<AutoDeploySettings>,
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
