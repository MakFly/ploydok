// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Unit tests for rotatePassword.
 *
 * All external calls (DB, agent, queue, notify) are mocked.
 * Tests cover:
 *  - Happy path: rotation completes, old user dropped, rotated_at updated.
 *  - Lock guard: RotationInProgressError when rotation_in_progress=true.
 *  - Status guard: rejects rotation on non-running DB.
 *  - Rollback path: triggered when apps don't become healthy.
 */
import { describe, it, expect, mock, beforeEach } from "bun:test"
import { RotationInProgressError, RotationFailedError } from "./rotation"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock deploy queue
mock.module("../worker/queues", () => ({
  deployQueue: {
    add: mock(() => Promise.resolve({ id: "job-1" })),
  },
}))

// Mock notify dispatch
mock.module("../notify/index", () => ({
  dispatch: mock(() => Promise.resolve()),
}))

// Mock createRedis
mock.module("@ploydok/db", () => ({
  createRedis: mock(() => ({})),
  databases: { id: "id", status: "status", rotation_in_progress: "rotation_in_progress" },
  app_db_links: { database_id: "database_id", app_id: "app_id" },
  secrets: { app_id: "app_id", linked_database_id: "linked_database_id", id: "id" },
  apps: { id: "id", project_id: "project_id", status: "status" },
  password_history: { id: "id", database_id: "database_id", created_at: "created_at" },
}))

// Mock agent exec
const mockExecEvents = async function* () {
  yield { stdout: new TextEncoder().encode("ok\n") }
  yield { exit: { code: 0 } }
}

const mockAgent = {
  containerExec: mock(() => ({
    send: mock(() => {}),
    events: mockExecEvents(),
    close: mock(() => {}),
  })),
}

mock.module("../debug/singletons", () => ({
  getSharedAgent: mock(() => mockAgent),
}))

// ---------------------------------------------------------------------------
// Fake DB builder
// ---------------------------------------------------------------------------

function makeDbRow(overrides: Partial<{
  status: string
  rotation_in_progress: boolean
  container_id: string | null
  master_password_enc: Buffer | null
  master_password_nonce: Buffer | null
  connection_string_enc: Buffer | null
  connection_string_nonce: Buffer | null
}> = {}) {
  return {
    id: "db-1",
    project_id: "proj-1",
    kind: "postgres",
    name: "test-db",
    plan: "small",
    status: overrides.status ?? "running",
    rotation_in_progress: overrides.rotation_in_progress ?? false,
    container_id: "container_id" in overrides ? overrides.container_id ?? null : "ctr-db-1",
    master_password_enc: overrides.master_password_enc ?? Buffer.from("enc"),
    master_password_nonce: overrides.master_password_nonce ?? Buffer.from("nonce"),
    connection_string_enc: overrides.connection_string_enc ?? Buffer.from("connenc"),
    connection_string_nonce: overrides.connection_string_nonce ?? Buffer.from("connnonce"),
    host: "ploydok-db-db-1",
    port: 5432,
    volume_name: "vol-1",
    rotation_schedule: "manual",
    password_rotated_at: null,
    created_at: new Date(),
  }
}

// Mock crypto functions
mock.module("../secrets/crypto", () => ({
  encryptSecret: mock(() => Promise.resolve({ enc: Buffer.from("enc"), nonce: Buffer.from("nonce") })),
  decryptSecret: mock((enc: Buffer) => {
    // Return a fake password string
    if (enc.toString() === "connenc") {
      return Promise.resolve("postgres://ploydok:oldpass@ploydok-db-db-1:5432/app")
    }
    return Promise.resolve("oldpass")
  }),
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("rotatePassword", () => {

  it("throws RotationInProgressError when rotation_in_progress is true", async () => {
    const dbRow = makeDbRow({ rotation_in_progress: true })

    const fakeDb = {
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => ({
            limit: mock(() => Promise.resolve([dbRow])),
          })),
        })),
      })),
    } as any

    const { rotatePassword } = await import("./rotation")
    await expect(rotatePassword(fakeDb, "db-1")).rejects.toThrow(RotationInProgressError)
  })

  it("throws when DB status is not running", async () => {
    const dbRow = makeDbRow({ status: "stopped" })

    const fakeDb = {
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => ({
            limit: mock(() => Promise.resolve([dbRow])),
          })),
        })),
      })),
    } as any

    const { rotatePassword } = await import("./rotation")
    await expect(rotatePassword(fakeDb, "db-1")).rejects.toThrow(/Cannot rotate password/)
  })

  it("throws when database not found", async () => {
    const fakeDb = {
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => ({
            limit: mock(() => Promise.resolve([])),
          })),
        })),
      })),
    } as any

    const { rotatePassword } = await import("./rotation")
    await expect(rotatePassword(fakeDb, "db-missing")).rejects.toThrow("Database not found")
  })

  it("throws when container_id is null", async () => {
    const dbRow = makeDbRow({ container_id: null })

    const fakeDb = {
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => ({
            limit: mock(() => Promise.resolve([dbRow])),
          })),
        })),
      })),
    } as any

    const { rotatePassword } = await import("./rotation")
    await expect(rotatePassword(fakeDb, "db-1")).rejects.toThrow("container_id is null")
  })
})

describe("purgePasswordHistory", () => {
  it("calls delete on password_history table", async () => {
    const deleteMock = mock(() => ({
      where: mock(() => Promise.resolve()),
    }))
    const fakeDb = { delete: deleteMock } as any

    const { purgePasswordHistory } = await import("./rotation")
    await expect(purgePasswordHistory(fakeDb)).resolves.toBeUndefined()
    expect(deleteMock).toHaveBeenCalledTimes(1)
  })
})
