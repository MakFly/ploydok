// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, mock } from "bun:test"
import { Hono } from "hono"

let githubConfigured = false
let gitlabConfigured = false
let githubConnected = false
let gitlabConnected = false
let gitlabExpiresAt: Date | null = null
let gitlabFailureCode: string | null = null

mock.module("@ploydok/db/queries", () => ({
  getGitHubAppConfig: async () =>
    githubConfigured ? { id: "singleton" } : null,
  getGitLabConfig: async () => (gitlabConfigured ? { id: "singleton" } : null),
  hasGitHubInstallationForUser: async () => githubConnected,
  getGitLabTokens: async () =>
    gitlabConnected ? { user_id: "user-1", expires_at: gitlabExpiresAt } : null,
}))

mock.module("../gitlab/connection", () => ({
  resolveGitLabConnection: async () => {
    if (gitlabFailureCode) {
      throw Object.assign(new Error(gitlabFailureCode), {
        code: gitlabFailureCode,
      })
    }
    if (
      !gitlabConnected ||
      (gitlabExpiresAt && gitlabExpiresAt.getTime() <= Date.now())
    ) {
      throw Object.assign(new Error("not connected"), {
        code:
          gitlabExpiresAt && gitlabExpiresAt.getTime() <= Date.now()
            ? "expired"
            : "not_connected",
      })
    }
    return { accessToken: "token" }
  },
}))

const { createGitProvidersRouter } = await import("./git-providers")

function buildApp() {
  const app = new Hono()
  app.use("*", async (c, next) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(c as any).set("user", {
      id: "user-1",
      email: "user@example.com",
      display_name: "User",
      session_id: "session-1",
    })
    return next()
  })
  app.route("/git-providers", createGitProvidersRouter({} as never))
  return app
}

beforeEach(() => {
  githubConfigured = false
  gitlabConfigured = false
  githubConnected = false
  gitlabConnected = false
  gitlabExpiresAt = null
  gitlabFailureCode = null
})

describe("GET /git-providers/status", () => {
  it("returns per-user readiness without exposing provider secrets", async () => {
    githubConfigured = true
    githubConnected = true
    gitlabConfigured = true

    const res = await buildApp().request("/git-providers/status")

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ready: true,
      github: { configured: true, connected: true },
      gitlab: { configured: true, connected: false },
    })
  })

  it("does not report a configured provider as connected for another user", async () => {
    githubConfigured = true
    gitlabConfigured = true

    const res = await buildApp().request("/git-providers/status")

    expect(await res.json()).toMatchObject({
      ready: false,
      github: { configured: true, connected: false },
      gitlab: { configured: true, connected: false },
    })
  })

  it("does not report an expired GitLab token as connected", async () => {
    gitlabConfigured = true
    gitlabConnected = true
    gitlabExpiresAt = new Date(Date.now() - 1_000)

    const res = await buildApp().request("/git-providers/status")

    expect(await res.json()).toMatchObject({
      ready: false,
      gitlab: { configured: true, connected: false, state: "expired" },
    })
  })

  it("distinguishes a GitLab outage from an account disconnection", async () => {
    gitlabConfigured = true
    gitlabFailureCode = "refresh_failed"

    const res = await buildApp().request("/git-providers/status")

    expect(await res.json()).toMatchObject({
      ready: false,
      gitlab: { configured: true, connected: false, state: "unavailable" },
    })
  })
})
