// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, describe, expect, it, mock } from "bun:test"
import { gitlab_config } from "@ploydok/db"
mock.module("../github/app-credentials", () => ({
  decryptField: async (value: Buffer) => value.toString(),
  encryptField: async (value: string) => ({
    enc: Buffer.from(value),
    nonce: Buffer.from("nonce"),
  }),
}))

const originalFetch = globalThis.fetch

describe("resolveGitLabConnection", () => {
  afterAll(() => {
    globalThis.fetch = originalFetch
  })

  it("serializes concurrent refreshes and reuses the rotated access token", async () => {
    let row = {
      user_id: "user-1",
      access_token_enc: Buffer.from("expired-access"),
      access_token_nonce: Buffer.from("nonce"),
      refresh_token_enc: Buffer.from("refresh-token"),
      refresh_token_nonce: Buffer.from("nonce"),
      expires_at: new Date(Date.now() - 1_000),
      created_at: new Date(),
      updated_at: new Date(),
    }
    let fetchCount = 0
    globalThis.fetch = mock(async () => {
      fetchCount += 1
      return new Response(
        JSON.stringify({
          access_token: "fresh-access",
          refresh_token: "fresh-refresh",
          expires_in: 3600,
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    }) as unknown as typeof fetch

    let lock = Promise.resolve()
    const tx = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => ({
              for: async () => [row],
            }),
          }),
        }),
      }),
      update: () => ({
        set: (patch: Partial<typeof row>) => ({
          where: async () => {
            row = { ...row, ...patch }
          },
        }),
      }),
    }
    const configRow = {
      id: "singleton",
      instance_url: "https://gitlab.example.test",
      client_id: "client-id",
      client_secret_enc: Buffer.from("client-secret"),
      client_secret_nonce: Buffer.from("nonce"),
    }
    const db = {
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: async () => (table === gitlab_config ? [configRow] : []),
          }),
        }),
      }),
      transaction: async <T>(callback: (value: typeof tx) => Promise<T>) => {
        const previous = lock
        let release: () => void = () => undefined
        lock = new Promise<void>((resolve) => {
          release = resolve
        })
        await previous
        try {
          return await callback(tx)
        } finally {
          release()
        }
      },
    }

    const { resolveGitLabConnection } = await import("./connection")
    const [first, second] = await Promise.all([
      resolveGitLabConnection(db as never, "user-1"),
      resolveGitLabConnection(db as never, "user-1"),
    ])

    expect(fetchCount).toBe(1)
    expect(first.accessToken).toBe("fresh-access")
    expect(second.accessToken).toBe("fresh-access")
    expect(row.expires_at.getTime()).toBeGreaterThan(Date.now())
  })
})
