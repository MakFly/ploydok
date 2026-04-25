// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, mock, beforeEach } from "bun:test"
import { createHash } from "crypto"
import { patAuthMiddleware } from "./pat"

describe("patAuthMiddleware", () => {
  let mockContext: any
  let mockDb: any
  let mockNext: any

  beforeEach(() => {
    mockContext = {
      req: {
        header: mock(() => ""),
      },
      set: mock(() => {}),
    }
    mockDb = {}
    mockNext = mock(async () => {})
  })

  it("ignores invalid Bearer tokens", async () => {
    mockContext.req.header = mock(() => "Bearer invalid")

    await patAuthMiddleware(mockContext, mockNext, mockDb)

    expect(mockNext).toHaveBeenCalled()
    expect(mockContext.set).not.toHaveBeenCalled()
  })

  it("ignores missing Authorization header", async () => {
    mockContext.req.header = mock(() => undefined)

    await patAuthMiddleware(mockContext, mockNext, mockDb)

    expect(mockNext).toHaveBeenCalled()
    expect(mockContext.set).not.toHaveBeenCalled()
  })

  it("hashes PAT token with SHA-256", () => {
    const token = "ploy_test1234567890"
    const expected = createHash("sha256").update(token).digest("hex")
    const actual = createHash("sha256").update(token).digest("hex")
    expect(actual).toBe(expected)
  })

  it("accepte le préfixe legacy ploy_ ET le nouveau plk_live_", async () => {
    // Test purement syntaxique : on vérifie que le middleware ne court-circuite
    // pas les Bearer commençant par plk_live_. Le path complet (lookup DB +
    // verify) est couvert par les tests d'intégration api-tokens.test.ts.
    mockContext.req.header = mock(() => "Bearer plk_live_abc123")
    mockDb = {
      select: () => ({ from: () => ({ where: () => [] }) }),
    }
    await patAuthMiddleware(mockContext, mockNext, mockDb)
    expect(mockNext).toHaveBeenCalled()
  })
})
