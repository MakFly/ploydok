// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, mock, test } from "bun:test"
import { ExecCommandAuditor } from "./exec-audit"

// Mock le module crypto pour ne pas requérir MASTER_KEY en test.
mock.module("../secrets/crypto", () => ({
  encryptSecret: async (plain: string) => ({
    enc: Buffer.from(plain, "utf8"),
    nonce: Buffer.from("000000000000", "utf8"),
  }),
}))

function fakeDb() {
  const inserts: Array<Record<string, unknown>> = []
  return {
    inserts,
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        inserts.push(row)
      },
    }),
  }
}

const ctx = {
  userId: "u1",
  appId: "app1",
  containerId: "c1",
  sessionId: "s1",
}

describe("ExecCommandAuditor", () => {
  test("flush une ligne sur \\n", async () => {
    const db = fakeDb()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = new ExecCommandAuditor(db as any, ctx)
    a.feed(new TextEncoder().encode("ls -la\n"))
    // attendre microtask flush
    await new Promise((r) => setTimeout(r, 5))
    expect(db.inserts.length).toBe(1)
    const row = db.inserts[0] as Record<string, string>
    expect(row.action).toBe("app.exec.command")
    expect(row.target_id).toBe("app1")
    const meta = JSON.parse(row.metadata as string) as {
      enc: string
      nonce: string
      alg: string
    }
    expect(meta.alg).toBe("aes-256-gcm")
    // Le mock encryptSecret encode plain en base64 directement
    expect(Buffer.from(meta.enc, "base64").toString("utf8")).toBe("ls -la")
  })

  test("flush plusieurs lignes successives", async () => {
    const db = fakeDb()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = new ExecCommandAuditor(db as any, ctx)
    a.feed(new TextEncoder().encode("cmd1\ncmd2\ncmd3\n"))
    await new Promise((r) => setTimeout(r, 10))
    expect(db.inserts.length).toBe(3)
  })

  test("flushFinal flushe le buffer même sans \\n", async () => {
    const db = fakeDb()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = new ExecCommandAuditor(db as any, ctx)
    a.feed(new TextEncoder().encode("partial"))
    await a.flushFinal()
    expect(db.inserts.length).toBe(1)
  })

  test("CR LF tous deux séparateurs", async () => {
    const db = fakeDb()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = new ExecCommandAuditor(db as any, ctx)
    a.feed(new TextEncoder().encode("a\rb\nc\r\n"))
    await new Promise((r) => setTimeout(r, 10))
    // a, b, c → 3 lignes (le \r\n compte juste comme 2 séparateurs successifs)
    expect(db.inserts.length).toBe(3)
  })

  test("ligne > 4KB est dropée silencieusement", async () => {
    const db = fakeDb()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = new ExecCommandAuditor(db as any, ctx)
    const huge = "x".repeat(5000) + "\n"
    a.feed(new TextEncoder().encode(huge))
    await new Promise((r) => setTimeout(r, 10))
    // La partie tronquée à 4KB est flushée quand même (les premiers 4096 bytes)
    expect(db.inserts.length).toBe(1)
    const row = db.inserts[0] as Record<string, string>
    const meta = JSON.parse(row.metadata as string) as { enc: string }
    const decoded = Buffer.from(meta.enc, "base64").toString("utf8")
    expect(decoded.length).toBe(4 * 1024) // tronqué à MAX_LINE_BYTES
  })
})
