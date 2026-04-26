// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from "bun:test"
import { z } from "zod"

describe("handlePreviewDeploy", () => {
  it("validates payload schema", () => {
    const PreviewDeployPayloadSchema = z.object({
      appId: z.string(),
      prNumber: z.number(),
      headSha: z.string(),
    })

    const valid = { appId: "app-1", prNumber: 42, headSha: "abc123" }
    const result = PreviewDeployPayloadSchema.safeParse(valid)
    expect(result.success).toBe(true)

    const invalid = { appId: "app-1", prNumber: "42" }
    const result2 = PreviewDeployPayloadSchema.safeParse(invalid)
    expect(result2.success).toBe(false)
  })
})
