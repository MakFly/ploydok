// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, mock, beforeEach } from "bun:test"
import { spawnDatabase } from "./spawner"
import type { DbKind, DbPlan } from "./spawner"

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockContainerCreate = mock(async () => ({ containerId: "test-container-id" }))
const mockNetworkCreate = mock(async () => ({ networkId: "test-net-id" }))

mock.module("../debug/singletons", () => ({
  getSharedAgent: () => ({
    containerCreate: mockContainerCreate,
    networkCreate: mockNetworkCreate,
  }),
  getSharedCaddy: () => ({}),
}))

const mockEnsureProjectNetwork = mock(async () => "ploydok-proj-test-project")

mock.module("../projects", () => ({
  ensureProjectNetwork: mockEnsureProjectNetwork,
  projectNetworkName: (id: string) => `ploydok-proj-${id}`,
  networksForApp: (net: string) => [net],
  PLOYDOK_INGRESS_NETWORK: "ploydok-ingress",
  PLOYDOK_PUBLIC_NETWORK: "ploydok-public",
}))

const mockEncryptSecret = mock(async (plaintext: string) => ({
  enc: Buffer.from(`enc:${plaintext}`),
  nonce: Buffer.from("nonce"),
}))

mock.module("../secrets/crypto", () => ({
  encryptSecret: mockEncryptSecret,
  decryptSecret: mock(async (enc: Buffer) => enc.toString().replace("enc:", "")),
}))

let insertedRow: Record<string, unknown> = {}
let updatedRow: Record<string, unknown> = {}

const mockDb = {
  insert: mock(() => ({
    values: mock(async (vals: Record<string, unknown>) => {
      insertedRow = vals
    }),
  })),
  update: mock(() => ({
    set: mock((vals: Record<string, unknown>) => ({
      where: mock(async () => {
        updatedRow = vals
      }),
    })),
  })),
} as unknown as import("@ploydok/db").Db

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("spawnDatabase", () => {
  beforeEach(() => {
    insertedRow = {}
    updatedRow = {}
    mockContainerCreate.mockClear()
    mockNetworkCreate.mockClear()
    mockEnsureProjectNetwork.mockClear()
    mockEncryptSecret.mockClear()
  })

  const kinds: DbKind[] = ["postgres", "redis", "mongo"]
  const plan: DbPlan = "small"

  for (const kind of kinds) {
    it(`spawns a ${kind} database`, async () => {
      const result = await spawnDatabase(mockDb, {
        projectId: "test-project",
        kind,
        name: `my-${kind}`,
        plan,
      })

      expect(result.id).toBeTruthy()
      expect(result.containerId).toBe("test-container-id")
      expect(result.connectionString).toBeTruthy()
      expect(result.connectionString).not.toContain("@generated(32)")

      expect(insertedRow.kind).toBe(kind)
      expect(insertedRow.status).toBe("creating")
      expect(insertedRow.project_id).toBe("test-project")

      expect(updatedRow.status).toBe("running")
      expect(updatedRow.container_id).toBe("test-container-id")
      expect(updatedRow.connection_string_enc).toBeTruthy()

      expect(mockContainerCreate).toHaveBeenCalledTimes(1)
      const calls = mockContainerCreate.mock.calls as Array<Array<{ image: string; restartPolicy: string }>>
      const createCall = calls.length > 0 ? calls[0] : null
      if (createCall && createCall.length > 0) {
        const callArg = createCall[0]
        expect(callArg?.image).toContain(kind === "mongo" ? "mongo" : kind)
        expect(callArg?.restartPolicy).toBe("unless-stopped")
      }
    })
  }

  it("connection string for postgres includes correct format", async () => {
    const result = await spawnDatabase(mockDb, {
      projectId: "proj-1",
      kind: "postgres",
      name: "mydb",
      plan: "medium",
    })
    expect(result.connectionString).toMatch(/^postgres:\/\//)
    expect(result.connectionString).toContain("@ploydok-db-")
    expect(result.connectionString).toContain(":5432/app")
  })

  it("connection string for redis includes correct format", async () => {
    const result = await spawnDatabase(mockDb, {
      projectId: "proj-2",
      kind: "redis",
      name: "myredis",
      plan: "small",
    })
    expect(result.connectionString).toMatch(/^redis:\/\//)
    expect(result.connectionString).toContain(":6379")
  })

  it("connection string for mongo includes correct format", async () => {
    const result = await spawnDatabase(mockDb, {
      projectId: "proj-3",
      kind: "mongo",
      name: "mymongo",
      plan: "large",
    })
    expect(result.connectionString).toMatch(/^mongodb:\/\//)
    expect(result.connectionString).toContain(":27017")
    expect(result.connectionString).toContain("authSource=admin")
  })
})
