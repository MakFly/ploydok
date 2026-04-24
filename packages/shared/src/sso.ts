// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod"

/**
 * SSO Config — what an admin sees (no client_secret).
 */
export const SSOConfigSummarySchema = z.object({
  id: z.string(),
  org_id: z.string(),
  issuer: z.string().url(),
  client_id: z.string(),
  redirect_uri: z.string().url(),
  scopes: z.string(),
  enabled: z.boolean(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
})
export type SSOConfigSummary = z.infer<typeof SSOConfigSummarySchema>

/**
 * Request body for creating/updating SSO config.
 * client_secret is plaintext (sent in request, encrypted on server).
 */
export const SSOConfigUpdateBodySchema = z.object({
  issuer: z.string().url().optional(),
  client_id: z.string().min(1).optional(),
  client_secret: z.string().min(1).optional(),
  redirect_uri: z.string().url().optional(),
  scopes: z.string().optional(),
})
export type SSOConfigUpdateBody = z.infer<typeof SSOConfigUpdateBodySchema>

export const SSOConfigCreateBodySchema = z.object({
  issuer: z.string().url(),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  redirect_uri: z.string().url(),
  scopes: z.string().optional().default("openid email profile"),
})
export type SSOConfigCreateBody = z.infer<typeof SSOConfigCreateBodySchema>

/**
 * SSO login callback response.
 */
export const SSOLoginResponseSchema = z.object({
  config: SSOConfigSummarySchema,
})
export type SSOLoginResponse = z.infer<typeof SSOLoginResponseSchema>

/**
 * SSO test connection response.
 */
export const SSOTestResponseSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
})
export type SSOTestResponse = z.infer<typeof SSOTestResponseSchema>
