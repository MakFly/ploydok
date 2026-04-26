// SPDX-License-Identifier: AGPL-3.0-only
import {
  describe,
  expect,
  it,
  mock,
  spyOn,
  beforeEach,
  afterEach,
} from "bun:test"
import * as installTokensMod from "../../github/installation-tokens"
import * as providerReposQueries from "@ploydok/db/queries"
import * as queues from "../queues"

// ---------------------------------------------------------------------------
// Minimal mock DB
// ---------------------------------------------------------------------------

type SelectChain = {
  from: (t: unknown) => SelectChain
  where: (c: unknown) => SelectChain
  limit: (n: number) => Promise<unknown[]>
  orderBy: (...args: unknown[]) => SelectChain
  then: (
    resolve: (v: unknown[]) => void,
    reject?: (err: unknown) => void
  ) => Promise<unknown[]>
  [Symbol.iterator]?: never
}

function makeSelectChain(rows: unknown[]): SelectChain {
  const chain: SelectChain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(rows),
    orderBy: () => chain,
    then: (resolve, reject) => {
      try {
        resolve(rows)
        return Promise.resolve(rows)
      } catch (err) {
        reject?.(err as Error)
        return Promise.reject(err)
      }
    },
  }
  return chain
}

function mockDb(opts: { gitlabTokenRows?: unknown[] } = {}) {
  return {
    select: (_fields?: unknown) => ({
      from: (_table: unknown) => makeSelectChain(opts.gitlabTokenRows ?? []),
    }),
    update: (_table: unknown) => ({
      set: (_values: unknown) => ({
        where: (_condition: unknown) => ({
          returning: () => Promise.resolve([{ id: "test" }]),
        }),
      }),
    }),
    insert: (_table: unknown) => ({
      values: (_values: unknown) => ({
        onConflictDoUpdate: (_opts: unknown) => Promise.resolve(),
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<void>) => fn(null),
  }
}

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

const mockEnqueue = mock(
  async (_jobId: string, _payload: unknown, _opts: unknown) => Promise.resolve()
)

// ---------------------------------------------------------------------------
// GitHub fan-out
// ---------------------------------------------------------------------------

describe("handleSyncProviderRepos — GitHub fan-out", () => {
  let upsertInstallationSpy: ReturnType<typeof spyOn>
  let enqueueReposSyncSpy: ReturnType<typeof spyOn>
  let listInstallationsSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    listInstallationsSpy = spyOn(
      installTokensMod,
      "listAppInstallations"
    ).mockResolvedValue([
      {
        id: 111,
        accountLogin: "org-a",
        accountType: "Organization",
        repositorySelection: "all",
        suspendedAt: null,
        htmlUrl: "https://github.com/orgs/org-a",
        avatarUrl: "https://avatars.githubusercontent.com/org-a",
      },
      {
        id: 222,
        accountLogin: "org-b",
        accountType: "Organization",
        repositorySelection: "selected",
        suspendedAt: null,
        htmlUrl: "https://github.com/orgs/org-b",
        avatarUrl: "https://avatars.githubusercontent.com/org-b",
      },
    ])

    upsertInstallationSpy = spyOn(
      providerReposQueries,
      "upsertInstallation"
    ).mockResolvedValue(undefined)

    // We spy on providerReposSyncQueue.add to capture enqueue calls
    spyOn(queues.providerReposSyncQueue, "add").mockImplementation(
      mockEnqueue as unknown as typeof queues.providerReposSyncQueue.add
    )
  })

  afterEach(() => {
    listInstallationsSpy.mockRestore()
    upsertInstallationSpy.mockRestore()
  })

  it("enqueues one child job per installation", async () => {
    const { handleSyncProviderRepos } = await import("./sync-provider-repos")
    const db = mockDb()
    mockEnqueue.mockClear()

    await handleSyncProviderRepos(db as never, { provider: "github" })

    expect(listInstallationsSpy).toHaveBeenCalledTimes(1)
    expect(upsertInstallationSpy).toHaveBeenCalledTimes(2)
    // Two child jobs enqueued (one per installation)
    expect(mockEnqueue.mock.calls.length).toBe(2)
    const payloads = mockEnqueue.mock.calls.map((c) => (c as unknown[])[1])
    expect(payloads).toContainEqual({
      provider: "github",
      installationId: "111",
    })
    expect(payloads).toContainEqual({
      provider: "github",
      installationId: "222",
    })
  })
})

// ---------------------------------------------------------------------------
// GitHub per-installation
// ---------------------------------------------------------------------------

describe("handleSyncProviderRepos — GitHub per-installation", () => {
  let listReposSpy: ReturnType<typeof spyOn>
  let replaceReposSpy: ReturnType<typeof spyOn>

  beforeEach(async () => {
    const { ghProvider } = await import("../../routes/github")

    // Page 1 returns 2 repos with hasMore=true, page 2 returns 1 repo with hasMore=false
    let callCount = 0
    listReposSpy = spyOn(ghProvider, "listRepos").mockImplementation(
      async () => {
        callCount++
        if (callCount === 1) {
          return {
            repos: [
              {
                id: 1,
                fullName: "org/repo-a",
                description: null,
                defaultBranch: "main",
                private: false,
                cloneUrl: "",
              },
              {
                id: 2,
                fullName: "org/repo-b",
                description: "desc",
                defaultBranch: "main",
                private: true,
                cloneUrl: "",
              },
            ],
            hasMore: true,
          }
        }
        return {
          repos: [
            {
              id: 3,
              fullName: "org/repo-c",
              description: null,
              defaultBranch: "develop",
              private: false,
              cloneUrl: "",
            },
          ],
          hasMore: false,
        }
      }
    )

    replaceReposSpy = spyOn(
      providerReposQueries,
      "replaceInstallationRepos"
    ).mockResolvedValue(undefined)
  })

  afterEach(() => {
    listReposSpy.mockRestore()
    replaceReposSpy.mockRestore()
  })

  it("walks pages until hasMore=false and calls replaceInstallationRepos once with merged list", async () => {
    const { handleSyncProviderRepos } = await import("./sync-provider-repos")
    const db = mockDb()

    await handleSyncProviderRepos(db as never, {
      provider: "github",
      installationId: "999",
    })

    expect(listReposSpy).toHaveBeenCalledTimes(2)
    expect(replaceReposSpy).toHaveBeenCalledTimes(1)

    const [, installId, rows] = replaceReposSpy.mock.calls[0] as [
      unknown,
      string,
      unknown[],
    ]
    expect(installId).toBe("github:999")
    expect(rows).toHaveLength(3)
  })

  it("logs error and does not throw when an installation fails", async () => {
    const { handleSyncProviderRepos } = await import("./sync-provider-repos")
    const db = mockDb()

    listReposSpy.mockRejectedValue(new Error("GitHub API down"))

    await expect(
      handleSyncProviderRepos(db as never, {
        provider: "github",
        installationId: "999",
      })
    ).resolves.toBeUndefined()

    // replaceInstallationRepos called with empty array (no rows accumulated)
    expect(replaceReposSpy).toHaveBeenCalledWith(db, "github:999", [])
  })
})

// ---------------------------------------------------------------------------
// GitLab per-user
// ---------------------------------------------------------------------------

describe("handleSyncProviderRepos — GitLab per-user", () => {
  it("converts GitLab repos correctly", async () => {
    const { handleSyncProviderRepos } = await import("./sync-provider-repos")

    // Mock getGitLabConfig
    const getGitLabConfigSpy = spyOn(
      providerReposQueries,
      "getGitLabConfig"
    ).mockResolvedValue({
      id: "singleton",
      instance_url: "https://gitlab.example.com",
      client_id: "cid",
      client_secret_enc: Buffer.from("enc"),
      client_secret_nonce: Buffer.from("nonce"),
      webhook_secret_enc: Buffer.from("wenc"),
      webhook_secret_nonce: Buffer.from("wnonce"),
    } as never)

    // Mock decryptField
    const appCredMod = await import("../../github/app-credentials")
    const decryptSpy = spyOn(appCredMod, "decryptField").mockResolvedValue(
      "fake-token"
    )

    // Mock upsertInstallation
    const upsertInstSpy = spyOn(
      providerReposQueries,
      "upsertInstallation"
    ).mockResolvedValue(undefined)

    // Mock replaceInstallationRepos
    const replaceSpy = spyOn(
      providerReposQueries,
      "replaceInstallationRepos"
    ).mockResolvedValue(undefined)

    // Mock GitLabProvider.listRepos
    const { GitLabProvider } = await import("../../gitlab/client")
    const listReposSpy = spyOn(
      GitLabProvider.prototype,
      "listRepos"
    ).mockResolvedValue({
      repos: [
        {
          id: 42,
          fullName: "group/project",
          description: "A project",
          defaultBranch: "main",
          private: false,
          cloneUrl: "https://gitlab.example.com/group/project.git",
        },
      ],
      hasMore: false,
    })

    const db = mockDb({
      gitlabTokenRows: [
        {
          user_id: "user-1",
          access_token_enc: Buffer.from("enc"),
          access_token_nonce: Buffer.from("nonce"),
          refresh_token_enc: null,
          refresh_token_nonce: null,
          expires_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ],
    })

    await handleSyncProviderRepos(db as never, {
      provider: "gitlab",
      userId: "user-1",
    })

    expect(listReposSpy).toHaveBeenCalled()
    expect(replaceSpy).toHaveBeenCalledTimes(1)

    const [, installId, rows] = replaceSpy.mock.calls[0] as [
      unknown,
      string,
      { id: string; full_name: string; provider: string }[],
    ]
    expect(installId).toBe("gitlab:user:user-1")
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe("gitlab:42")
    expect(rows[0]?.full_name).toBe("group/project")
    expect(rows[0]?.provider).toBe("gitlab")

    getGitLabConfigSpy.mockRestore()
    decryptSpy.mockRestore()
    upsertInstSpy.mockRestore()
    replaceSpy.mockRestore()
    listReposSpy.mockRestore()
  })
})
