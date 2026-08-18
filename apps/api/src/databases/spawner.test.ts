// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, mock, beforeEach } from "bun:test"
import {
  extractPasswordFromConnectionString,
  compensateDatabaseCreation,
  resumeDatabaseCreation,
  spawnDatabase,
  startDatabaseContainer,
} from "./spawner"
import type { DbKind, DbPlan } from "./spawner"

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockContainerCreate = mock(async () => ({
  containerId: "test-container-id",
}))
const mockContainerStart = mock(async () => ({}))
const mockContainerRemove = mock(
  async (_req: {
    containerId: string
    force: boolean
    removeVolumes: boolean
  }) => ({})
)
const mockNetworkCreate = mock(async () => ({ networkId: "test-net-id" }))
const mockUpsertTcpProxy = mock(async () => undefined)
const mockRemoveTcpProxy = mock(async () => undefined)
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
    containerRemove: mockContainerRemove,
    listContainers: mockListContainers,
    networkCreate: mockNetworkCreate,
  }),
  getSharedCaddy: () => ({
    upsertTcpProxy: mockUpsertTcpProxy,
    removeTcpProxy: mockRemoveTcpProxy,
  }),
}))

let sagaState: {
  state:
    | "initializing"
    | "provisioning"
    | "compensating"
    | "failed"
    | "complete"
    | "compensated"
  completed_steps: string[]
  owned_resources: Record<string, string>
  attempt_count: number
} | null = null

mock.module("@ploydok/db/queries", () => ({
  createCreationSaga: mock(
    async (
      _db: unknown,
      input: {
        completedSteps?: string[]
        ownedResources?: Record<string, string>
      }
    ) => {
      sagaState ??= {
        state: "initializing",
        completed_steps: input.completedSteps ?? [],
        owned_resources: input.ownedResources ?? {},
        attempt_count: 0,
      }
    }
  ),
  getCreationSaga: mock(async () => sagaState),
  claimCreationSaga: mock(async () => {
    if (
      !sagaState ||
      sagaState.state === "complete" ||
      sagaState.state === "compensated"
    )
      return null
    sagaState.state = "provisioning"
    sagaState.attempt_count += 1
    return { saga: sagaState, token: "test-compensation-token" }
  }),
  fenceCreationSaga: mock(async () => true),
  recordClaimedCreationSagaStep: mock(
    async (
      _db: unknown,
      _type: string,
      _id: string,
      _token: string,
      step: string,
      resources: Record<string, string> = {}
    ) => {
      if (!sagaState) return false
      if (!sagaState.completed_steps.includes(step))
        sagaState.completed_steps.push(step)
      Object.assign(sagaState.owned_resources, resources)
      return true
    }
  ),
  completeClaimedCreationSaga: mock(async () => {
    if (sagaState) sagaState.state = "complete"
    return true
  }),
  retryClaimedCreationSaga: mock(async () => {
    if (sagaState) sagaState.state = "failed"
    return true
  }),
  beginClaimedCreationSagaCompensation: mock(async () => {
    if (sagaState) sagaState.state = "compensating"
    return true
  }),
  completeClaimedCreationSagaCompensation: mock(async () => {
    if (sagaState) sagaState.state = "compensated"
    return true
  }),
  beginCreationSagaAttempt: mock(async () => {
    if (sagaState && sagaState.state !== "complete")
      sagaState.state = "provisioning"
  }),
  beginCreationSagaCompensation: mock(async () => {
    if (sagaState && sagaState.state !== "complete") {
      sagaState.state = "provisioning"
    }
  }),
  recordCreationSagaStep: mock(
    async (
      _db: unknown,
      _type: string,
      _id: string,
      step: string,
      resources: Record<string, string> = {}
    ) => {
      if (!sagaState) return
      if (!sagaState.completed_steps.includes(step))
        sagaState.completed_steps.push(step)
      Object.assign(sagaState.owned_resources, resources)
    }
  ),
  completeCreationSaga: mock(async () => {
    if (sagaState) sagaState.state = "complete"
  }),
  failCreationSaga: mock(async () => {
    if (sagaState && sagaState.state !== "complete") sagaState.state = "failed"
  }),
}))

const mockEnsureProjectNetwork = mock(async () => "ploydok-proj-test-project")

mock.module("../services/projects", () => ({
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
  decryptSecret: mock(async (enc: Buffer) =>
    enc.toString().replace("enc:", "")
  ),
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
  transaction: mock(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback(mockDb)
  ),
} as unknown as import("@ploydok/db").Db

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("extractPasswordFromConnectionString", () => {
  it("extracts a PostgreSQL password without relying on URL.password", () => {
    expect(
      extractPasswordFromConnectionString(
        "postgres://ploydok:s3cr3t@db:5432/app?serverVersion=16&charset=utf8"
      )
    ).toBe("s3cr3t")
  })

  it("supports encoded separators and empty usernames", () => {
    expect(
      extractPasswordFromConnectionString("redis://:p%40ss%2Fword@redis:6379")
    ).toBe("p@ss/word")
  })
})

describe("spawnDatabase", () => {
  beforeEach(() => {
    insertedRow = {}
    updatedRows = []
    mockContainerCreate.mockClear()
    mockContainerStart.mockClear()
    mockContainerRemove.mockClear()
    mockListContainers.mockClear()
    mockNetworkCreate.mockClear()
    mockEnsureProjectNetwork.mockClear()
    mockEncryptSecret.mockClear()
    mockUpsertTcpProxy.mockClear()
    mockRemoveTcpProxy.mockClear()
    sagaState = null
  })

  const kinds: DbKind[] = ["postgres", "redis", "mongo", "libsql"]
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

      expect(
        updatedRows.some((row) => row.container_id === "test-container-id")
      ).toBe(true)
      expect(insertedRow.connection_string_enc).toBeTruthy()
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
        expect(callArg?.image).toContain(
          kind === "mongo" ? "mongo" : kind === "libsql" ? "libsql" : kind
        )
        expect(callArg?.name).toMatch(/^ploydok-[a-z0-9][a-z0-9-]{0,62}$/)
        expect(callArg?.healthcheck?.test?.[0]).toBe("CMD-SHELL")
        if (kind === "postgres") {
          expect(callArg?.healthcheck?.test?.[1]).toContain(
            "pg_isready -U $POSTGRES_USER -d $POSTGRES_DB"
          )
        }
        if (kind === "libsql") {
          expect(callArg?.healthcheck?.test?.[1]).toContain("127.0.0.1:8080")
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
    expect(result.connectionString).toContain("serverVersion=16")
    expect(result.connectionString).toContain("charset=utf8")
  })

  it("resumes after a crash without creating a second container", async () => {
    mockContainerStart.mockImplementationOnce(async () => {
      throw new Error("simulated crash after container create")
    })

    await expect(
      spawnDatabase(mockDb, {
        projectId: "proj-crash",
        ownerId: "user-1",
        kind: "postgres",
        name: "crash-db",
        plan: "small",
      })
    ).rejects.toThrow("simulated crash")
    expect(sagaState?.state).toBe("failed")
    expect(sagaState?.completed_steps).toContain("container_created")

    await resumeDatabaseCreation(
      mockDb,
      insertedRow as unknown as import("@ploydok/db").DatabaseRow,
      "user-1"
    )

    expect(mockContainerCreate).toHaveBeenCalledTimes(1)
    expect(mockContainerStart).toHaveBeenCalledTimes(2)
    expect(sagaState?.state).toBe("complete")
  })

  it("compensates owned runtime resources after a terminal creation failure", async () => {
    mockContainerStart.mockImplementationOnce(async () => {
      throw new Error("terminal failure")
    })
    await expect(
      spawnDatabase(mockDb, {
        projectId: "proj-compensate",
        ownerId: "user-1",
        kind: "postgres",
        name: "compensate-db",
        plan: "small",
      })
    ).rejects.toThrow("terminal failure")

    await compensateDatabaseCreation(
      mockDb,
      insertedRow as unknown as import("@ploydok/db").DatabaseRow,
      "test-compensation-token",
      "test compensation"
    )

    expect(mockContainerRemove).toHaveBeenCalledTimes(1)
    expect(mockContainerRemove.mock.calls[0]?.[0]).toMatchObject({
      force: true,
      removeVolumes: true,
    })
    expect(sagaState?.completed_steps).toContain("container_compensated")
    expect(sagaState?.completed_steps).toContain("runtime_compensated")
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

  it("connection string for libsql matches Dokploy-style internal URL", async () => {
    const result = await spawnDatabase(mockDb, {
      projectId: "proj-4",
      ownerId: "user-1",
      kind: "libsql",
      name: "mylibsql",
      plan: "small",
    })
    expect(result.connectionString).toMatch(/^http:\/\/libsql:/)
    expect(result.connectionString).toContain("@ploydok-db-")
    expect(result.connectionString).toContain(":8080")
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
    const createCalls = Array.from(
      mockContainerCreate.mock.calls as Array<Array<unknown>>
    )
    const createArg = (createCalls[0]?.[0] ?? null) as null | {
      name: string
      healthcheck?: { test?: string[] }
      labels?: Record<string, string>
    }
    expect(createArg?.name).toBe("ploydok-db-vw6p3llb5e-refyv-xhrg")
    expect(createArg?.healthcheck?.test?.[0]).toBe("CMD-SHELL")
    expect(createArg?.labels?.["ploydok.owner_id"]).toBe("user-1")
    expect(createArg?.labels?.["ploydok.app_id"]).toBe("vw6P3lLB5e-rEFyV-XhRG")
    expect(
      updatedRows.some(
        (nextRow) => nextRow.host === "ploydok-db-vw6p3llb5e-refyv-xhrg"
      )
    ).toBe(true)
    expect(
      updatedRows.some(
        (nextRow) => nextRow.container_id === "test-container-id"
      )
    ).toBe(true)
  })
})
