// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod"

/**
 * License claims in the JWT payload.
 */
export const LicenseClaimsSchema = z.object({
  plan: z.enum(["pro", "enterprise"]),
  seats: z.number().int().positive(),
  exp: z.number(), // unix seconds
  iat: z.number(), // unix seconds
  issuer: z.literal("ploydok"),
  license_id: z.string().uuid(),
})

export type LicenseClaims = z.infer<typeof LicenseClaimsSchema>

/**
 * License status response.
 */
export const LicenseStatusSchema = z.object({
  activated: z.boolean(),
  plan: z.enum(["pro", "enterprise"]).optional(),
  seats: z.number().int().optional(),
  expires_at: z.string().datetime().optional(),
  is_expired: z.boolean(),
})

export type LicenseStatus = z.infer<typeof LicenseStatusSchema>

/**
 * License activation request payload.
 */
export const LicenseActivateRequestSchema = z.object({
  jwt: z.string().min(1),
})

export type LicenseActivateRequest = z.infer<
  typeof LicenseActivateRequestSchema
>

/**
 * License activation response.
 */
export const LicenseActivateResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  plan: z.enum(["pro", "enterprise"]).optional(),
  expires_at: z.string().datetime().optional(),
})

export type LicenseActivateResponse = z.infer<
  typeof LicenseActivateResponseSchema
>
