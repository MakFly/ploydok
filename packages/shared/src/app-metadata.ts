// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod"

function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

export const SafeHttpUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .url()
  .refine(isSafeHttpUrl, "URL must use http:// or https://")

export const AppQuickLinkSchema = z.object({
  label: z.string().trim().min(1).max(40),
  url: SafeHttpUrlSchema,
})
export type AppQuickLink = z.infer<typeof AppQuickLinkSchema>

export const AppMetadataSchema = z.object({
  iconUrl: SafeHttpUrlSchema.nullable(),
  quickLinks: z.array(AppQuickLinkSchema).max(8),
})
export type AppMetadata = z.infer<typeof AppMetadataSchema>

export const UpdateAppMetadataSchema = z.object({
  iconUrl: SafeHttpUrlSchema.nullable().optional(),
  quickLinks: z.array(AppQuickLinkSchema).max(8).optional(),
})
export type UpdateAppMetadata = z.infer<typeof UpdateAppMetadataSchema>
