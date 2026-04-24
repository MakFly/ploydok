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
  'succeeded_with_warning',
  'failed',
  'cancelled',
]);
export type BuildStatus = z.infer<typeof BuildStatusSchema>;

/**
 * `docker` is the legacy alias for `dockerfile` — kept in the enum so rows
 * written before sprint 3.2 still validate on read. New writes should use
 * `dockerfile`. Normalize via `normalizeBuildMethod()` before any switch.
 */
export const BuildMethodSchema = z.enum([
  'auto',
  'docker',
  'dockerfile',
  'recipe',
  'compose',
  'nixpacks',
  'railpack',
]);
export type BuildMethod = z.infer<typeof BuildMethodSchema>;

export type NormalizedBuildMethod = Exclude<BuildMethod, 'docker'>;

export function normalizeBuildMethod(value: BuildMethod): NormalizedBuildMethod {
  return value === 'docker' ? 'dockerfile' : value;
}

export const RecipeIdSchema = z.enum([
  'php-laravel.v1',
  'php-symfony.v1',
  'php-generic.v1',
]);
export type RecipeId = z.infer<typeof RecipeIdSchema>;

/**
 * Build-time knobs passed to a managed recipe. All fields optional — each
 * recipe supplies its own defaults when a field is absent.
 */
export const RecipeVarsSchema = z.object({
  phpVersion: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  nodeVersion: z.string().optional(),
  rootDir: z.string().optional(),
  publicDir: z.string().optional(),
  runtimePort: z.number().int().positive().max(65535).optional(),
  installCommand: z.string().optional(),
  buildCommand: z.string().optional(),
  composerFlags: z.string().optional(),
  // Free-form env identifier: Symfony uses prod/dev/test/staging/preprod/preview,
  // Laravel uses production/local/staging, Node uses production/development/test.
  // Recipes classify it via isProductionAppEnv() to decide build posture.
  appEnv: z.string().min(1).max(32).regex(/^[a-z0-9][a-z0-9_-]*$/i).optional(),
}).strict();
export type RecipeVars = z.infer<typeof RecipeVarsSchema>;

export const RestartPolicySchema = z.enum(['no', 'always', 'unless-stopped', 'on-failure']);
export type RestartPolicy = z.infer<typeof RestartPolicySchema>;

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

export const ImagePullPolicySchema = z.enum(['always', 'if_not_present']);
export type ImagePullPolicy = z.infer<typeof ImagePullPolicySchema>;

export const SecretPhaseSchema = z.enum(['build', 'runtime', 'both']);
export type SecretPhase = z.infer<typeof SecretPhaseSchema>;

// ---------------------------------------------------------------------------
// AppConfig
// ---------------------------------------------------------------------------

export const AppConfigSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  organizationId: z.string().optional(),
  projectId: z.string().optional(),
  gitProvider: z.custom<GitProviderKind>((v) => v === 'github'),
  repoFullName: z.string(),   // 'owner/repo'
  branch: z.string(),
  rootDir: z.string().optional(),
  dockerfilePath: z.string().optional(),
  nixpacksConfigPath: z.string().optional(),
  nodeVersion: z.string().optional(),
  installCommand: z.string().optional(),
  buildCommand: z.string().optional(),
  startCommand: z.string().optional(),
  watchPaths: z.array(z.string()).optional(),
  buildMethod: BuildMethodSchema.optional(),
  recipeId: RecipeIdSchema.nullish(),
  recipeVersion: z.string().nullish(),
  runtimePort: z.number().int().positive().optional(),
  restartPolicy: RestartPolicySchema.optional(),
  healthcheck: HealthcheckConfigSchema.optional(),
  domain: z.string().optional(),
})
  .refine((value) => Boolean(value.organizationId ?? value.projectId), {
    message: "organizationId or projectId is required",
    path: ["organizationId"],
  })
  .refine(
    (v) => {
      if (!v.buildMethod) return true;
      if (normalizeBuildMethod(v.buildMethod) === 'recipe') {
        return Boolean(v.recipeId);
      }
      return true;
    },
    { message: "recipeId is required when buildMethod is 'recipe'", path: ["recipeId"] },
  );
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
  // Set when post-deploy hook fails (status = succeeded_with_warning)
  postDeployError: z.string().nullable().optional(),
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
