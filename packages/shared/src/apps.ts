// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";

import type { GitProviderKind } from "./git-providers";

// ---------------------------------------------------------------------------
// Status enums
// ---------------------------------------------------------------------------

export const AppStatusSchema = z.enum([
  'created',
  'pending',
  'building',
  'running',
  'restarting',
  'failed',
  'stopped',
]);
export type AppStatus = z.infer<typeof AppStatusSchema>;

export const BuildStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);
export type BuildStatus = z.infer<typeof BuildStatusSchema>;

export const BuildMethodSchema = z.enum(['docker', 'nixpacks', 'auto']);
export type BuildMethod = z.infer<typeof BuildMethodSchema>;

export const JobStatusSchema = z.enum(['pending', 'running', 'done', 'failed']);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobTypeSchema = z.enum([
  'deploy.requested',
  'gc.registry',
  'cleanup.build',
]);
export type JobType = z.infer<typeof JobTypeSchema>;

// ---------------------------------------------------------------------------
// HealthcheckConfig
// ---------------------------------------------------------------------------

export const HealthcheckConfigSchema = z.object({
  path: z.string().default('/'),
  port: z.number().int().optional(),
  intervalS: z.number().int().default(5),
  timeoutS: z.number().int().default(3),
  retries: z.number().int().default(6),
  startPeriodS: z.number().int().default(0),
});
export type HealthcheckConfig = z.infer<typeof HealthcheckConfigSchema>;

// ---------------------------------------------------------------------------
// AppConfig
// ---------------------------------------------------------------------------

export const AppConfigSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  projectId: z.string(),
  gitProvider: z.custom<GitProviderKind>((v) => v === 'github'),
  repoFullName: z.string(),   // 'owner/repo'
  branch: z.string(),
  rootDir: z.string().optional(),
  dockerfilePath: z.string().optional(),
  installCommand: z.string().optional(),
  buildCommand: z.string().optional(),
  startCommand: z.string().optional(),
  watchPaths: z.array(z.string()).optional(),
  buildMethod: BuildMethodSchema.optional(),
  healthcheck: HealthcheckConfigSchema.optional(),
  domain: z.string().optional(),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export const BuildSchema = z.object({
  id: z.string(),
  appId: z.string(),
  status: BuildStatusSchema,
  buildMethod: BuildMethodSchema.nullable().optional(),
  imageTag: z.string().optional(),
  containerId: z.string().optional(),
  commitSha: z.string().optional(),
  commitMessage: z.string().nullable().optional(),
  startedAt: z.number().optional(),   // unix ms
  finishedAt: z.number().optional(),  // unix ms
  createdAt: z.number(),              // unix ms
});
export type Build = z.infer<typeof BuildSchema>;

// ---------------------------------------------------------------------------
// Job
// ---------------------------------------------------------------------------

export const JobSchema = z.object({
  id: z.string(),
  type: JobTypeSchema,
  payload: z.unknown(),
  status: JobStatusSchema,
  runAt: z.number().optional(), // unix ms
  createdAt: z.number(),        // unix ms
  updatedAt: z.number(),        // unix ms
});
export type Job = z.infer<typeof JobSchema>;
