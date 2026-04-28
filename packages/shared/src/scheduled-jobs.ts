// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod"

export const ScheduledJobKindEnum = z.enum(["app_exec", "container_run"])

export const ScheduledJobRunStatusEnum = z.enum([
  "running",
  "succeeded",
  "failed",
  "timeout",
])

export const ScheduledJobCreateSchema = z.object({
  name: z.string().min(1).max(255),
  schedule_cron: z.string().min(1),
  kind: ScheduledJobKindEnum,
  app_id: z.string().optional(),
  image: z.string().optional(),
  command: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  timeout_seconds: z.number().int().positive().default(300),
  enabled: z.boolean().default(true),
})

export type ScheduledJobCreateInput = z.infer<typeof ScheduledJobCreateSchema>

export const ScheduledJobUpdateSchema =
  ScheduledJobCreateSchema.partial() as ReturnType<
    typeof ScheduledJobCreateSchema.partial
  >

export type ScheduledJobUpdateInput = z.infer<typeof ScheduledJobUpdateSchema>

export const ScheduledJobSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  schedule_cron: z.string(),
  kind: ScheduledJobKindEnum,
  app_id: z.string().nullable(),
  image: z.string().nullable(),
  command: z.array(z.string()).nullable(),
  timeout_seconds: z.number(),
  enabled: z.boolean(),
  last_run_at: z.date().nullable(),
  last_run_status: ScheduledJobRunStatusEnum.nullable(),
  next_run_at: z.date().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
})

export type ScheduledJobSummary = z.infer<typeof ScheduledJobSummarySchema>

export const ScheduledJobDetailSchema = ScheduledJobSummarySchema.extend({
  env: z.record(z.string(), z.string()),
})

export type ScheduledJobDetail = z.infer<typeof ScheduledJobDetailSchema>

export const ScheduledJobRunSchema = z.object({
  id: z.string(),
  job_id: z.string(),
  started_at: z.date(),
  finished_at: z.date().nullable(),
  status: ScheduledJobRunStatusEnum,
  exit_code: z.number().nullable(),
  output: z.string().nullable(),
  error: z.string().nullable(),
})

export type ScheduledJobRun = z.infer<typeof ScheduledJobRunSchema>

export const ListScheduledJobsResponseSchema = z.object({
  jobs: z.array(ScheduledJobSummarySchema),
})

export type ListScheduledJobsResponse = z.infer<
  typeof ListScheduledJobsResponseSchema
>

export const GetScheduledJobResponseSchema = z.object({
  job: ScheduledJobDetailSchema,
  recentRuns: z.array(ScheduledJobRunSchema),
})

export type GetScheduledJobResponse = z.infer<
  typeof GetScheduledJobResponseSchema
>
