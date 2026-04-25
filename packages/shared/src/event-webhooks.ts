// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod"

export const WEBHOOK_EVENTS = [
  "deploy.started",
  "deploy.succeeded",
  "deploy.failed",
  "app.created",
  "app.updated",
  "app.deleted",
  "database.created",
  "database.deleted",
  "service.installed",
  "service.started",
  "service.stopped",
  "service.deleted",
] as const

export const WebhookEventEnum = z.enum(WEBHOOK_EVENTS)

export type WebhookEvent = z.infer<typeof WebhookEventEnum>

export const CreateEventWebhookSchema = z.object({
  name: z.string().min(1).max(255),
  url: z.string().url(),
  events: z.array(WebhookEventEnum).nonempty(),
  secret: z.string().optional(),
})

export type CreateEventWebhookInput = z.infer<typeof CreateEventWebhookSchema>

export const UpdateEventWebhookSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  url: z.string().url().optional(),
  events: z.array(WebhookEventEnum).optional(),
  enabled: z.boolean().optional(),
  secret: z.string().optional(),
})

export type UpdateEventWebhookInput = z.infer<typeof UpdateEventWebhookSchema>

export const WebhookSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  events: z.array(WebhookEventEnum),
  enabled: z.boolean(),
  last_triggered_at: z.date().nullable(),
  last_response_status: z.number().nullable(),
  last_error: z.string().nullable(),
  created_at: z.date(),
})

export type WebhookSummary = z.infer<typeof WebhookSummarySchema>

export const WebhookPayloadSchema = z.object({
  event: WebhookEventEnum,
  timestamp: z.string(),
  org_id: z.string(),
  org_slug: z.string(),
  data: z.record(z.string(), z.unknown()),
})

export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>

export const TestWebhookPayloadSchema = z.object({
  event: z.literal("webhook.test"),
  timestamp: z.string(),
  org_id: z.string(),
  org_slug: z.string(),
  data: z.object({}),
})

export type TestWebhookPayload = z.infer<typeof TestWebhookPayloadSchema>
