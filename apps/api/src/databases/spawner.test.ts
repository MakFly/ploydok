// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, mock, beforeEach } from "bun:test"
import { spawnDatabase, startDatabaseContainer } from "./spawner"
import type { DbKind, DbPlan } from "./spawner"

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockContainerCreate = mock(async () => ({ containerId: "test-container-id" }))
const mockContainerStart = mock(async () => ({}))
const mockNetworkCreate = mock(async () => ({ networkId: "test-net-id" }))
const mockListContainers = mock(async () => ({
  containers: [
    {
      id: "test-container-id",
      status: "running",
    },
  ],
}))

mock.module("../debug/singletons", () => ({
  getSharedAgent: () => ({
    containerCreate: mockContainerCreate,
    containerStart: mockContainerStart,
    listContainers: mockListContainers,
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
let updatedRows: Array<Record<string, unknown>> = []

const mockDb = {
  insert: mock(() => ({
    values: mock(async (vals: Record<string, unknown>) => {
      insertedRow = vals
    }),
  })),
  update: mock(() => ({
    set: mock((vals: Record<string, unknown>) => ({
      where: mock(async () => {
        updatedRows.push(vals)
      }),
    })),
  })),
} as unknown as import("@ploydok/db").Db

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("spawnDatabase", () => {
  beforeEach(() => {
    insertedRow = {}
    updatedRows = []
    mockContainerCreate.mockClear()
    mockContainerStart.mockClear()
    mockListContainers.mockClear()
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
        ownerId: "user-1",
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

      expect(updatedRows.some((row) => row.container_id === "test-container-id")).toBe(true)
      expect(updatedRows.some((row) => row.connection_string_enc)).toBe(true)
      expect(updatedRows[updatedRows.length - 1]?.status).toBe("running")

      expect(mockContainerCreate).toHaveBeenCalledTimes(1)
      const calls = mockContainerCreate.mock.calls as Array<
        Array<{
          image: string
          name: string
          restartPolicy: string
          healthcheck?: {
            test?: string[]
          }
          labels?: Record<string, string>
        }>
      >
      const createCall = calls.length > 0 ? calls[0] : null
      if (createCall && createCall.length > 0) {
        const callArg = createCall[0]
        expect(callArg?.image).toContain(kind === "mongo" ? "mongo" : kind)
        expect(callArg?.name).toMatch(/^ploydok-[a-z0-9][a-z0-9-]{0,62}$/)
        expect(callArg?.healthcheck?.test?.[0]).toBe("CMD-SHELL")
        if (kind === "postgres") {
          expect(callArg?.healthcheck?.test?.[1]).toContain("pg_isready -U $POSTGRES_USER -d $POSTGRES_DB")
        }
        expect(callArg?.labels?.["ploydok.owner_id"]).toBe("user-1")
        expect(callArg?.labels?.["ploydok.app_id"]).toBe(result.id)
        expect(callArg?.restartPolicy).toBe("unless-stopped")
      }
    })
  }

  it("connection string for postgres includes correct format", async () => {
    const result = await spawnDatabase(mockDb, {
      projectId: "proj-1",
      ownerId: "user-1",
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
      ownerId: "user-1",
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
      ownerId: "user-1",
      kind: "mongo",
      name: "mymongo",
      plan: "large",
    })
    expect(result.connectionString).toMatch(/^mongodb:\/\//)
    expect(result.connectionString).toContain(":27017")
    expect(result.connectionString).toContain("authSource=admin")
  })

  it("reprovisions a missing container on start", async () => {
    const row = {
      id: "vw6P3lLB5e-rEFyV-XhRG",
      project_id: "test-project",
      kind: "postgres",
      version: "16",
      name: "my-postgres",
      plan: "small",
      container_id: null,
      volume_name: "ploydok-db-vw6P3lLB5e-rEFyV-XhRG",
      connection_string_enc: null,
      connection_string_nonce: null,
      master_password_enc: null,
      master_password_nonce: null,
      status: "creating",
      health_status: "starting",
      host: "ploydok-db-vw6P3lLB5e-rEFyV-XhRG",
      port: 5432,
      exposure_mode: "internal",
      public_enabled: false,
      public_port: null,
      public_host: null,
      public_url: null,
      rotation_schedule: "manual",
      rotation_in_progress: false,
      password_rotated_at: null,
      last_started_at: null,
      created_at: new Date(),
    } as import("@ploydok/db").DatabaseRow

    await startDatabaseContainer(mockDb, row, { ownerId: "user-1" })

    expect(mockContainerCreate).toHaveBeenCalledTimes(1)
    expect(mockContainerStart).toHaveBeenCalledTimes(1)
    const createCalls = Array.from(mockContainerCreate.mock.calls as Array<Array<unknown>>)
    const createArg = (createCalls[0]?.[0] ?? null) as
      | null
      | {
        name: string
        healthcheck?: { test?: string[] }
        labels?: Record<string, string>
      }
    expect(createArg?.name).toBe("ploydok-db-vw6p3llb5e-refyv-xhrg")
    expect(createArg?.healthcheck?.test?.[0]).toBe("CMD-SHELL")
    expect(createArg?.labels?.["ploydok.owner_id"]).toBe("user-1")
    expect(createArg?.labels?.["ploydok.app_id"]).toBe("vw6P3lLB5e-rEFyV-XhRG")
    expect(updatedRows.some((nextRow) => nextRow.host === "ploydok-db-vw6p3llb5e-refyv-xhrg")).toBe(true)
    expect(updatedRows.some((nextRow) => nextRow.container_id === "test-container-id")).toBe(true)
  })
})
