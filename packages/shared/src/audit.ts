// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod"

export const AuditEventSchema = z.object({
  id: z.number(),
  user_id: z.string().nullable(),
  action: z.string(),
  target_type: z.string(),
  target_id: z.string(),
  metadata: z.string(),
  created_at: z.coerce.date(),
  prev_hash: z.string().nullable(),
  hash: z.string().nullable(),
  org_id: z.string().nullable(),
})

export type AuditEvent = z.infer<typeof AuditEventSchema>

export const AuditListResponseSchema = z.object({
  events: z.array(AuditEventSchema),
  nextCursor: z.number().nullable(),
})

export type AuditListResponse = z.infer<typeof AuditListResponseSchema>
