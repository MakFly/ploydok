// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod"

export const ApiTokenCreateSchema = z.object({
  name: z.string().min(1).max(255),
  expiresInDays: z.number().int().positive().optional(),
})

export type ApiTokenCreateInput = z.infer<typeof ApiTokenCreateSchema>

export const ApiTokenSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  created_at: z.date(),
  last_used_at: z.date().nullable(),
  expires_at: z.date().nullable(),
  revoked_at: z.date().nullable(),
})

export type ApiTokenSummary = z.infer<typeof ApiTokenSummarySchema>

export const ApiTokenResponseSchema = z.object({
  token: z.string(),
  row: ApiTokenSummarySchema,
})

export type ApiTokenResponse = z.infer<typeof ApiTokenResponseSchema>
