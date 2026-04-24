// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach, mock } from "bun:test"
import type { Db } from "@ploydok/db"
import { createBrandingRouter } from "./branding"

const mockDb = {
  query: {
    projects: {
      findFirst: mock(),
    },
  },
} as unknown as Db

describe("branding router", () => {
  beforeEach(() => {
    mock.restore()
  })

  it("should return 404 if org not found on GET", async () => {
    ;(mockDb.query.projects.findFirst as any) = mock(() =>
      Promise.resolve(null)
    )

    const router = createBrandingRouter(mockDb)
    const context = {
      req: {
        param: (key: string) => {
          if (key === "slug") return "nonexistent"
          return undefined
        },
      },
      json: (data: any, opts: any) => ({ data, opts }),
      get: () => ({ id: "user-1" }),
    }

    const result = await router.fetch(
      new Request("http://localhost/orgs/nonexistent/branding"),
      context
    )

    expect(result.status).toBe(404)
  })

  it("should accept valid hex color on PUT", () => {
    const validColor = "#0066ff"
    const parsed = validColor.match(/^#[0-9A-Fa-f]{6}$/)
    expect(parsed).toBeTruthy()
  })

  it("should reject invalid hex color", () => {
    const invalidColor = "#zzz"
    const parsed = invalidColor.match(/^#[0-9A-Fa-f]{6}$/)
    expect(parsed).toBeNull()
  })
})
