// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, mock } from "bun:test"
import { Hono } from "hono"

let githubConfigured = false
let gitlabConfigured = false
let githubConnected = false
let gitlabConnected = false

mock.module("@ploydok/db/queries", () => ({
  getGitHubAppConfig: async () => (githubConfigured ? { id: "singleton" } : null),
  getGitLabConfig: async () => (gitlabConfigured ? { id: "singleton" } : null),
  hasGitHubInstallationForUser: async () => githubConnected,
  getGitLabTokens: async () => (gitlabConnected ? { user_id: "user-1" } : null),
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
})
