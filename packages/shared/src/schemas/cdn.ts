// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod"

export const CdnConfigSchema = z.object({
  mode: z.enum(["off", "internal", "external"]),
  cache_ttl_s: z.number().int().min(0).max(86400),
  cache_paths: z.array(z.string()).default([]),
  compression: z.boolean().default(false),
  image_optim: z.boolean().default(false),
  headers: z.record(z.string().regex(/^[A-Za-z-]+$/), z.string()).default({}),
  external_provider: z.literal("cloudflare").nullable().default(null),
})

export type CdnConfig = z.infer<typeof CdnConfigSchema>
