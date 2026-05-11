// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, mock, beforeEach } from "bun:test"
import { Hono } from "hono"
import type { Db } from "@ploydok/db"
import type { AuthUser } from "../auth/middleware"

type InvitationRow = {
  id: string
  org_id: string
}

type InvitationColumn = keyof InvitationRow

const invitationRows: InvitationRow[] = []
const invitationColumns = new Set<InvitationColumn>(["id", "org_id"])

mock.module("@ploydok/db", () => ({
  membership_invitations: {
    id: "id",
    org_id: "org_id",
  },
  projects: {
    id: "id",
    slug: "slug",
  },
}))

mock.module("@ploydok/db/queries", () => ({
  countOwners: async () => 2,
  createInvitation: async () => null,
  findPendingInvitationByEmail: async () => null,
  getMembership: async () => ({ role: "owner" }),
  isOrgOwner: async () => true,
  listMembershipsForOrg: async () => [],
  listPendingInvitationsForOrg: async () => [],
  removeMembership: async () => undefined,
  updateMembershipRole: async () => undefined,
}))

mock.module("../mailer", () => ({
  renderInvitationEmail: () => ({ html: "", text: "" }),
  sendMail: async () => undefined,
}))

const { membership_invitations } = await import("@ploydok/db")
const { createMembershipsRouter } = await import("./memberships")

const fakeUser: AuthUser = {
  id: "owner-user",
  email: "owner@example.com",
  display_name: "Owner",
  session_id: "session-1",
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function queryChunks(value: unknown): unknown[] {
  if (isRecord(value) && Array.isArray(value["queryChunks"])) {
    return value["queryChunks"]
  }
  return []
}

function stringChunk(value: unknown): string | null {
  if (!isRecord(value) || !Array.isArray(value["value"])) {
    return null
  }
  const parts = value["value"]
  return parts.every((part) => typeof part === "string")
    ? parts.join("")
    : null
}

function columnName(value: unknown): InvitationColumn | null {
  if (
    typeof value === "string" &&
    invitationColumns.has(value as InvitationColumn)
  ) {
    return value as InvitationColumn
  }

  const chunk = stringChunk(value)
  if (chunk && invitationColumns.has(chunk as InvitationColumn)) {
    return chunk as InvitationColumn
  }

  if (isRecord(value) && typeof value["name"] === "string") {
    const name = value["name"]
    return invitationColumns.has(name as InvitationColumn)
      ? (name as InvitationColumn)
      : null
  }

  return null
}

function paramValue(value: unknown): unknown {
  if (typeof value === "string") return value
  if (isRecord(value) && "encoder" in value && "value" in value) {
    return value["value"]
  }
  return undefined
}

function collectEquals(condition: unknown): Partial<InvitationRow> {
  const equals: Partial<InvitationRow> = {}
  const chunks = queryChunks(condition)

  for (const chunk of chunks) {
    if (queryChunks(chunk).length > 0) {
      Object.assign(equals, collectEquals(chunk))
    }
  }

  for (let index = 0; index < chunks.length; index += 1) {
    const name = columnName(chunks[index])
    if (!name) continue
    const operator = stringChunk(chunks[index + 1])?.trim()
    if (operator === "=") {
      const value = paramValue(chunks[index + 2])
      if (typeof value === "string") {
        equals[name] = value
      }
    }
  }

  return equals
}

function buildDb(): Db {
  const db = {
    select: () => {
      const chain = {
        from() {
          return chain
        },
        where() {
          return chain
        },
        limit: async () => [{ id: "org-a" }],
      }
      return chain
    },
    delete: (table: unknown) => ({
      where: (condition: unknown) => ({
        returning: async () => {
          if (table !== membership_invitations) return []
          const filters = collectEquals(condition)
          const deleted: Array<{ id: string }> = []
          for (let index = invitationRows.length - 1; index >= 0; index -= 1) {
            const row = invitationRows[index]
            if (
              row &&
              row.id === filters.id &&
              (!filters.org_id || row.org_id === filters.org_id)
            ) {
              invitationRows.splice(index, 1)
              deleted.push({ id: row.id })
            }
          }
          return deleted
        },
      }),
    }),
  }

  return db as unknown as Db
}

function buildApp(db: Db) {
  const app = new Hono<{ Variables: { user: AuthUser } }>()
  app.use("*", async (c, next) => {
    c.set("user", fakeUser)
    await next()
  })
  app.route("/", createMembershipsRouter(db))
  return app
}

beforeEach(() => {
  invitationRows.length = 0
})

describe("DELETE /:orgId/invitations/:invitationId", () => {
  it("returns 404 when the invitation belongs to another org", async () => {
    invitationRows.push({ id: "inv-cross", org_id: "org-b" })
    const app = buildApp(buildDb())

    const res = await app.request("/org-a/invitations/inv-cross", {
      method: "DELETE",
    })

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Invitation not found" },
    })
    expect(invitationRows).toEqual([{ id: "inv-cross", org_id: "org-b" }])
  })
})
