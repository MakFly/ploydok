// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, mock } from "bun:test"
import { Hono } from "hono"
import type { Db } from "@ploydok/db"
import type { AuthUser } from "../auth/middleware"

const projectA = {
  id: "project-a",
  owner_id: "owner-1",
  name: "Project A",
  slug: "workspace-a",
  network_name: null,
  is_default: false,
  created_at: new Date("2026-01-01T00:00:00.000Z"),
}

let accessibleProject: typeof projectA | null = projectA
let ownedProject: typeof projectA | null = projectA

const envRow = {
  id: "env-1",
  project_id: projectA.id,
  key: "API_TOKEN",
  value_enc: Buffer.from("encrypted"),
  value_nonce: Buffer.from("nonce"),
  is_secret: true,
  created_at: new Date("2026-01-01T00:00:00.000Z"),
  updated_at: new Date("2026-01-02T00:00:00.000Z"),
}

const plainEnvRow = {
  ...envRow,
  id: "env-2",
  key: "PUBLIC_ORIGIN",
  is_secret: false,
}

const listProjectEnvMock = mock(async () => [envRow, plainEnvRow])
const upsertProjectEnvMock = mock(async () => envRow)
const deleteProjectEnvMock = mock(async () => undefined)

mock.module("@ploydok/db", () => ({
  createDb: mock(() => ({})),
}))

mock.module("@ploydok/db/queries", () => ({
  getProjectForUser: mock(async () => accessibleProject),
  getProjectForOwner: mock(async () => ownedProject),
  listProjectEnv: listProjectEnvMock,
  upsertProjectEnv: upsertProjectEnvMock,
  deleteProjectEnv: deleteProjectEnvMock,
}))

mock.module("../github/app-credentials", () => ({
  encryptField: mock(async (value: string) => ({
    enc: Buffer.from(`encrypted:${value}`),
    nonce: Buffer.from("nonce"),
  })),
  decryptField: mock(async () => "clear-value"),
}))

mock.module("../auth/middleware", () => ({
  requireSecondFactor: () => async (_c: unknown, next: () => Promise<void>) =>
    next(),
}))

const { createProjectEnvRouter } = await import("./project-env")

const owner: AuthUser = {
  id: "owner-1",
  email: "owner@example.test",
  display_name: "Owner",
  session_id: "session-1",
}

function buildApp(user: AuthUser = owner) {
  const app = new Hono<{ Variables: { user: AuthUser } }>()
  app.use("*", async (c, next) => {
    c.set("user", user)
    return next()
  })

  const scoped = new Hono()
  scoped.route("/:orgSlug/shared-env", createProjectEnvRouter({} as Db))
  app.route("/orgs", scoped)
  return app
}

const basePath = "/orgs/workspace-a/shared-env/project-a/env"

beforeEach(() => {
  accessibleProject = projectA
  ownedProject = projectA
  listProjectEnvMock.mockClear()
  upsertProjectEnvMock.mockClear()
  deleteProjectEnvMock.mockClear()
})

describe("project-env authorization", () => {
  it("allows a member to list masked values", async () => {
    ownedProject = null

    const res = await buildApp({ ...owner, id: "member-1" }).request(basePath)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      vars: [
        {
          key: "API_TOKEN",
          value: "***",
          isSecret: true,
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
        {
          key: "PUBLIC_ORIGIN",
          value: "***",
          isSecret: false,
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    })
  })

  it("allows an owner to reveal a value", async () => {
    const res = await buildApp().request(`${basePath}/reveal/API_TOKEN`)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ value: "clear-value" })
  })

  it("returns the same 404 for a non-owner reveal without reading env rows", async () => {
    ownedProject = null

    const res = await buildApp({ ...owner, id: "member-1" }).request(
      `${basePath}/reveal/API_TOKEN`
    )

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Project not found" },
    })
    expect(listProjectEnvMock).not.toHaveBeenCalled()
  })

  it("returns 404 and performs no write when a non-owner upserts", async () => {
    ownedProject = null

    const res = await buildApp({ ...owner, id: "member-1" }).request(basePath, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vars: [{ key: "API_TOKEN", value: "new-value", isSecret: true }],
      }),
    })

    expect(res.status).toBe(404)
    expect(upsertProjectEnvMock).not.toHaveBeenCalled()
  })

  it("returns 404 and performs no write when a non-owner deletes", async () => {
    ownedProject = null

    const res = await buildApp({ ...owner, id: "member-1" }).request(
      `${basePath}/API_TOKEN`,
      { method: "DELETE" }
    )

    expect(res.status).toBe(404)
    expect(deleteProjectEnvMock).not.toHaveBeenCalled()
  })

  it("does not disclose or mutate a project mounted under another workspace", async () => {
    const foreignPath = "/orgs/workspace-b/shared-env/project-a/env"

    const reveal = await buildApp().request(`${foreignPath}/reveal/API_TOKEN`)
    const update = await buildApp().request(foreignPath, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vars: [{ key: "API_TOKEN", value: "new-value", isSecret: true }],
      }),
    })
    const remove = await buildApp().request(`${foreignPath}/API_TOKEN`, {
      method: "DELETE",
    })

    expect([reveal.status, update.status, remove.status]).toEqual([404, 404, 404])
    expect(listProjectEnvMock).not.toHaveBeenCalled()
    expect(upsertProjectEnvMock).not.toHaveBeenCalled()
    expect(deleteProjectEnvMock).not.toHaveBeenCalled()
  })

  it("allows an owner to create/update and delete shared values", async () => {
    const update = await buildApp().request(basePath, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vars: [{ key: "API_TOKEN", value: "new-value", isSecret: true }],
      }),
    })
    const remove = await buildApp().request(`${basePath}/API_TOKEN`, {
      method: "DELETE",
    })

    expect(update.status).toBe(200)
    expect(remove.status).toBe(200)
    expect(upsertProjectEnvMock).toHaveBeenCalledTimes(1)
    expect(deleteProjectEnvMock).toHaveBeenCalledWith(
      expect.anything(),
      projectA.id,
      "API_TOKEN"
    )
  })
})
