// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, mock, beforeEach } from "bun:test"
import type { AppForCommitStatus } from "./commit-status"

// ---------------------------------------------------------------------------
// Minimal Redis mock
// ---------------------------------------------------------------------------

let redisSetCalls: Array<{ key: string; returnValue: string | null }> = []
let redisSetReturn: string | null = "OK"

const redisMock = {
  set: mock(async (key: string, ..._args: unknown[]) => {
    redisSetCalls.push({ key, returnValue: redisSetReturn })
    return redisSetReturn
  }),
}

// ---------------------------------------------------------------------------
// Fetch mock — captures calls
// ---------------------------------------------------------------------------

type FetchBody = Record<string, string> | null
let fetchCalls: Array<{ url: string; method: string; body: FetchBody }> = []
let fetchStatus = 201

const origFetch = globalThis.fetch
beforeEach(() => {
  fetchCalls = []
  redisSetCalls = []
  redisSetReturn = "OK"
  redisMock.set.mockClear()
  ;(globalThis as unknown as Record<string, unknown>)["fetch"] = mock(
    async (url: string, init?: RequestInit) => {
      const body: FetchBody = init?.body ? (JSON.parse(init.body as string) as FetchBody) : null
      fetchCalls.push({ url, method: init?.method ?? "GET", body })
      return new Response(JSON.stringify({ id: 1 }), { status: fetchStatus })
    },
  )
})

// Restore real fetch after all tests (belt-and-suspenders)
import { afterAll } from "bun:test"
afterAll(() => {
  ;(globalThis as unknown as Record<string, unknown>)["fetch"] = origFetch
})

mock.module("../github/installation-tokens", () => ({
  getInstallationToken: mock(async (_id: string) => "gh-token-xyz"),
}))

mock.module("../github/app-credentials", () => ({
  decryptField: mock(async (enc: Buffer, _nonce: Buffer) => {
    return enc.toString("utf-8")
  }),
}))

mock.module("@ploydok/db/queries", () => ({
  getGitLabConfig: mock(async () => ({
    instance_url: "https://gitlab.example.com",
    client_id: "test-client",
    client_secret_enc: Buffer.from("secret"),
    client_secret_nonce: Buffer.from("nonce"),
    webhook_secret_enc: Buffer.from("wh"),
    webhook_secret_nonce: Buffer.from("whn"),
  })),
  getGitLabTokens: mock(async (_db: unknown, _userId: string) => ({
    user_id: "user1",
    access_token_enc: Buffer.from("gl-access-token"),
    access_token_nonce: Buffer.from("nonce"),
    refresh_token_enc: null,
    refresh_token_nonce: null,
    expires_at: null,
  })),
}))

const dbMock = {} as unknown as import("@ploydok/db").Db
type RedisLike = { set: (...args: unknown[]) => Promise<string | null> }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("postCommitStatusForApp", () => {
  const shaFixture = "abc123def456"

  function makeGitHubApp(overrides: Partial<AppForCommitStatus> = {}): AppForCommitStatus {
    return {
      id: "app1",
      git_provider: "github",
      repo_full_name: "myorg/myrepo",
      github_installation_id: "install-42",
      owner_id: "user1",
      post_commit_status: true,
      ...overrides,
    }
  }

  function makeGitLabApp(overrides: Partial<AppForCommitStatus> = {}): AppForCommitStatus {
    return {
      id: "app2",
      git_provider: "gitlab",
      repo_full_name: "myorg/myrepo",
      github_installation_id: null,
      owner_id: "user1",
      post_commit_status: true,
      ...overrides,
    }
  }

  it("posts pending status to GitHub", async () => {
    const { postCommitStatusForApp } = await import("./commit-status")
    await postCommitStatusForApp(dbMock, redisMock as unknown as import("@ploydok/db").Redis, makeGitHubApp(), {
      sha: shaFixture,
      state: "pending",
      description: "Build started",
    })

    const call = fetchCalls.find((c) => c.url.includes("/statuses/"))
    expect(call).toBeDefined()
    expect(call?.url).toContain(`/repos/myorg/myrepo/statuses/${shaFixture}`)
    expect(call?.body).toMatchObject({ state: "pending", context: "ploydok/build" })
    expect(redisMock.set).toHaveBeenCalledTimes(1)
  })

  it("posts success status to GitHub with correct state", async () => {
    const { postCommitStatusForApp } = await import("./commit-status")
    await postCommitStatusForApp(dbMock, redisMock as unknown as import("@ploydok/db").Redis, makeGitHubApp(), {
      sha: shaFixture,
      state: "success",
      buildNumber: 5,
      durationMs: 12345,
    })

    const call = fetchCalls.find((c) => c.url.includes("/statuses/"))
    expect(call?.body).toMatchObject({ state: "success" })
    expect(call?.body?.description).toMatch(/Build #5/)
  })

  it("posts failure status to GitHub with correct state", async () => {
    const { postCommitStatusForApp } = await import("./commit-status")
    await postCommitStatusForApp(dbMock, redisMock as unknown as import("@ploydok/db").Redis, makeGitHubApp(), {
      sha: shaFixture,
      state: "failure",
    })

    const call = fetchCalls.find((c) => c.url.includes("/statuses/"))
    expect(call?.body?.state).toBe("failure")
  })

  it("does not post when post_commit_status is false", async () => {
    const { postCommitStatusForApp } = await import("./commit-status")
    await postCommitStatusForApp(
      dbMock,
      redisMock as unknown as import("@ploydok/db").Redis,
      makeGitHubApp({ post_commit_status: false }),
      { sha: shaFixture, state: "pending" },
    )

    expect(fetchCalls).toHaveLength(0)
    expect(redisMock.set).not.toHaveBeenCalled()
  })

  it("posts to GitLab statuses endpoint with mapped state", async () => {
    const { postCommitStatusForApp } = await import("./commit-status")
    await postCommitStatusForApp(dbMock, redisMock as unknown as import("@ploydok/db").Redis, makeGitLabApp(), {
      sha: shaFixture,
      state: "failure",
    })

    const call = fetchCalls.find((c) => c.url.includes("/statuses/"))
    expect(call).toBeDefined()
    expect(call?.url).toContain(`/statuses/${shaFixture}`)
    // GitLab maps failure → failed
    expect(call?.url).toContain("state=failed")
  })

  it("skips second identical call within 60s (dedup)", async () => {
    const { postCommitStatusForApp } = await import("./commit-status")
    const app = makeGitHubApp()

    // First call: Redis SETNX returns "OK" (new key)
    redisSetReturn = "OK"
    await postCommitStatusForApp(dbMock, redisMock as unknown as import("@ploydok/db").Redis, app, {
      sha: shaFixture,
      state: "pending",
    })
    const firstCount = fetchCalls.length

    // Second call: Redis SETNX returns null (key already exists)
    redisSetReturn = null
    await postCommitStatusForApp(dbMock, redisMock as unknown as import("@ploydok/db").Redis, app, {
      sha: shaFixture,
      state: "pending",
    })

    // No additional fetch calls
    expect(fetchCalls.length).toBe(firstCount)
  })
})
