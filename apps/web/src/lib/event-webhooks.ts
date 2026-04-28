// SPDX-License-Identifier: AGPL-3.0-only
import { apiFetch } from "./api"
import type { WebhookSummary } from "@ploydok/shared"

export async function listEventWebhooks(
  orgSlug: string
): Promise<Array<WebhookSummary>> {
  const data = await apiFetch<{ webhooks: Array<WebhookSummary> }>(
    `/orgs/${orgSlug}/event-webhooks`
  )
  return data.webhooks || []
}

export async function createEventWebhook(
  orgSlug: string,
  payload: { name: string; url: string; events: Array<string>; secret?: string }
): Promise<WebhookSummary & { secret?: string }> {
  return apiFetch<WebhookSummary & { secret?: string }>(
    `/orgs/${orgSlug}/event-webhooks`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  )
}

export async function updateEventWebhook(
  orgSlug: string,
  webhookId: string,
  payload: Partial<{
    name: string
    url: string
    events: Array<string>
    enabled: boolean
    secret: string
  }>
): Promise<WebhookSummary> {
  return apiFetch<WebhookSummary>(
    `/orgs/${orgSlug}/event-webhooks/${webhookId}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    }
  )
}

export async function deleteEventWebhook(
  orgSlug: string,
  webhookId: string
): Promise<void> {
  await apiFetch(`/orgs/${orgSlug}/event-webhooks/${webhookId}`, {
    method: "DELETE",
  })
}

export async function testEventWebhook(
  orgSlug: string,
  webhookId: string
): Promise<{ status: number; latency_ms: number; error?: string }> {
  return apiFetch<{ status: number; latency_ms: number; error?: string }>(
    `/orgs/${orgSlug}/event-webhooks/${webhookId}/test`,
    {
      method: "POST",
    }
  )
}
