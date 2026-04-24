// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod"

export const ServiceStatus = z.enum([
  "created",
  "pending",
  "running",
  "stopped",
  "failed",
  "deleting",
])
export type ServiceStatus = z.infer<typeof ServiceStatus>

export const ServiceSummary = z.object({
  id: z.string(),
  project_id: z.string(),
  name: z.string(),
  slug: z.string(),
  template_id: z.string(),
  template_version: z.string().nullable(),
  status: ServiceStatus.nullable(),
  domain: z.string().nullable(),
  created_at: z.date().or(z.string()),
})
export type ServiceSummary = z.infer<typeof ServiceSummary>

export const ServiceDetail = ServiceSummary.extend({
  compose_raw: z.string(),
  generated_env: z.record(z.string(), z.string()),
  container_ids: z.array(z.string()),
})
export type ServiceDetail = z.infer<typeof ServiceDetail>

export const CreateServiceFromTemplateBody = z.object({
  projectId: z.string().min(1),
  templateId: z.string().min(1),
  templateVersion: z.string().min(1),
  name: z.string().min(1).max(64),
  compose: z.string().min(1).max(200_000),
})
export type CreateServiceFromTemplateBody = z.infer<
  typeof CreateServiceFromTemplateBody
>
