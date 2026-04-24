// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod"

const HexColorRegex = /^#[0-9A-Fa-f]{6}$/

export const OrgBrandingSchema = z.object({
  org_id: z.string(),
  app_name: z.string().min(1).max(255).default("Ploydok"),
  logo_url: z.string().url().nullable().optional(),
  primary_color: z
    .string()
    .regex(
      HexColorRegex,
      "Primary color must be a valid hex color (e.g., #0066ff)"
    )
    .nullable()
    .optional(),
  favicon_url: z.string().url().nullable().optional(),
  created_at: z.date(),
  updated_at: z.date(),
})

export const UpdateOrgBrandingSchema = z.object({
  app_name: z.string().min(1).max(255).optional(),
  logo_url: z.string().url().nullable().optional(),
  primary_color: z
    .string()
    .regex(
      HexColorRegex,
      "Primary color must be a valid hex color (e.g., #0066ff)"
    )
    .nullable()
    .optional(),
  favicon_url: z.string().url().nullable().optional(),
})

export type OrgBranding = z.infer<typeof OrgBrandingSchema>
export type UpdateOrgBranding = z.infer<typeof UpdateOrgBrandingSchema>
