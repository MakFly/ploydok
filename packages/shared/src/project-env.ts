// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod"

const ENV_KEY_REGEX = /^[A-Z][A-Z0-9_]*$/

export const ProjectEnvVarSchema = z.object({
  key: z
    .string()
    .regex(ENV_KEY_REGEX, "Key must be UPPER_SNAKE_CASE (e.g. MY_VAR)"),
  value: z.string(),
  isSecret: z.boolean().default(true),
})

export const ProjectEnvVarListSchema = z.object({
  vars: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
      isSecret: z.boolean(),
      updatedAt: z.string().datetime(),
    })
  ),
})

export type ProjectEnvVar = z.infer<typeof ProjectEnvVarSchema>
export type ProjectEnvVarList = z.infer<typeof ProjectEnvVarListSchema>
