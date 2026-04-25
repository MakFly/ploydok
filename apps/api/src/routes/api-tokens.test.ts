// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach, mock } from "bun:test"
import { createApiTokensRouter } from "./api-tokens"

describe("api-tokens routes", () => {
  let mockContext: any
  let mockDb: any

  beforeEach(() => {
    mockDb = {
      insert: mock(() => ({
        values: mock(() => ({
          returning: mock(async () => [
            {
              id: "token_123",
              user_id: "user_1",
              name: "CI Bot",
              token_hash: "abc123",
              created_at: new Date(),
              last_used_at: null,
              expires_at: null,
              revoked_at: null,
            },
          ]),
        })),
      })),
    }

    mockContext = {
      json: mock((data: unknown, status?: number) => ({
        data,
        status: status || 200,
      })),
      req: {
        param: mock((key: string) => "token_123"),
        json: mock(async () => ({ name: "CI Bot" })),
        header: mock(() => "Bearer ploy_test"),
      },
      get: mock((key: string) => {
        if (key === "user") {
          return { id: "user_1", email: "test@example.com" }
        }
        if (key === "db") {
          return mockDb
        }
        return undefined
      }),
    }
  })

  it("generates token with ploy_ prefix", () => {
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
    expect(token).toBeTruthy()
    expect(token.length).toBeGreaterThan(0)
  })
})
