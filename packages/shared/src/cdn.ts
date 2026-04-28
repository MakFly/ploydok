// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod"

const HeaderNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9-]*$/, "invalid HTTP header name")

const CachePathSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^\//, "cache paths must start with /")

export const CdnModeSchema = z.enum(["off", "internal", "external"])
export type CdnMode = z.infer<typeof CdnModeSchema>

export const CdnExternalProviderSchema = z.literal("cloudflare")
export type CdnExternalProvider = z.infer<typeof CdnExternalProviderSchema>

export const CdnConfigSchema = z.object({
  mode: CdnModeSchema.default("off"),
  cache_ttl_s: z.number().int().min(0).max(86_400).default(300),
  cache_paths: z.array(CachePathSchema).max(32).default([]),
  compression: z.boolean().default(false),
  image_optim: z.boolean().default(false),
  headers: z.record(HeaderNameSchema, z.string().max(1024)).default({}),
  external_provider: CdnExternalProviderSchema.nullable().default(null),
})
export type CdnConfig = z.infer<typeof CdnConfigSchema>

export const CloudflareManagedCdnSchema = z.object({
  api_token: z.string().min(20).max(512).optional(),
  zone_id: z.string().min(1).max(128),
  zone_name: z.string().min(1).max(255).nullable().optional(),
  hostname: z.string().min(1).max(255),
  origin: z.string().min(1).max(255),
  cache_ttl_s: z.number().int().min(0).max(86_400).default(300),
  cache_paths: z.array(CachePathSchema).max(32).default([]),
  headers: z.record(HeaderNameSchema, z.string().max(1024)).default({}),
})
export type CloudflareManagedCdn = z.infer<typeof CloudflareManagedCdnSchema>

export interface CloudflareManagedCdnStatus {
  configured: boolean
  zone_id: string | null
  zone_name: string | null
  hostname: string | null
  origin: string | null
  status: "pending" | "syncing" | "configured" | "failed" | null
  last_sync_error: string | null
  synced_at: string | null
  dns_record_id: string | null
  ruleset_rule_id: string | null
}
