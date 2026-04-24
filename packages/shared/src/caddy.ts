// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod"

export const ALLOWED_HANDLERS = [
  "headers",
  "rewrite",
  "redir",
  "static_response",
  "request_body",
  "vars",
] as const

export const CaddyHandlerSchema = z
  .object({
    handler: z.enum(ALLOWED_HANDLERS),
  })
  .passthrough()

export const CaddyExtraHandlersSchema = z.array(CaddyHandlerSchema).max(20)

export type CaddyExtraHandlers = z.infer<typeof CaddyExtraHandlersSchema>
