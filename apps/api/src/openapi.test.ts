// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test"
import { createOpenApiDocument } from "./openapi"

describe("createOpenApiDocument", () => {
  it("generates OpenAPI paths from Hono route metadata", () => {
    const doc = createOpenApiDocument([
      { method: "GET", path: "/health" },
      { method: "POST", path: "/apps/:id/deploy" },
      { method: "ALL", path: "/*" },
      { method: "GET", path: "/__test/throw" },
    ])

    expect(doc.openapi).toBe("3.1.0")
    const health = doc.paths["/health"]?.get
    const deploy = doc.paths["/apps/{id}/deploy"]?.post

    expect(health?.security).toBeUndefined()
    expect(deploy?.parameters).toEqual([
      {
        in: "path",
        name: "id",
        required: true,
        schema: { type: "string" },
      },
    ])
    expect(deploy?.security).toContainEqual({
      cookieAuth: [],
      csrfToken: [],
    })
    expect(doc.paths["/*"]).toBeUndefined()
    expect(doc.paths["/__test/throw"]).toBeUndefined()
  })
})
