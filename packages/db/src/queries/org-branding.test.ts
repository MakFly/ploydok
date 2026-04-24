// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach, mock } from "bun:test"
import type { Db } from "../client"
import {
  getOrgBranding,
  upsertOrgBranding,
  deleteOrgBranding,
} from "./org-branding"

const mockDb = {
  query: {
    org_branding: {
      findFirst: mock(),
    },
  },
  update: mock(),
  insert: mock(),
  delete: mock(),
} as unknown as Db

describe("org-branding queries", () => {
  beforeEach(() => {
    mock.restore()
  })

  it("should get org branding when it exists", async () => {
    const branding = {
      org_id: "org-1",
      app_name: "Custom App",
      logo_url: "https://example.com/logo.png",
      primary_color: "#0066ff",
      favicon_url: "https://example.com/favicon.ico",
      created_at: new Date(),
      updated_at: new Date(),
    }

    ;(mockDb.query.org_branding.findFirst as any) = mock(() =>
      Promise.resolve(branding)
    )

    const result = await getOrgBranding(mockDb, "org-1")
    expect(result).toEqual(branding)
  })

  it("should return null when org branding does not exist", async () => {
    ;(mockDb.query.org_branding.findFirst as any) = mock(() =>
      Promise.resolve(null)
    )

    const result = await getOrgBranding(mockDb, "org-1")
    expect(result).toBeNull()
  })

  it("should upsert org branding when it exists", async () => {
    const existing = {
      org_id: "org-1",
      app_name: "Custom App",
      logo_url: "https://example.com/logo.png",
      primary_color: "#0066ff",
      favicon_url: "https://example.com/favicon.ico",
      created_at: new Date(),
      updated_at: new Date(),
    }

    const updated = {
      ...existing,
      app_name: "Updated App",
      updated_at: new Date(),
    }

    ;(mockDb.query.org_branding.findFirst as any) = mock(() =>
      Promise.resolve(existing)
    )

    const updateMock = mock(() => ({
      set: mock(() => ({
        where: mock(() => ({
          returning: mock(() => Promise.resolve([updated])),
        })),
      })),
    }))

    ;(mockDb.update as any) = updateMock

    const result = await upsertOrgBranding(mockDb, "org-1", {
      app_name: "Updated App",
    })

    expect(result.app_name).toBe("Updated App")
  })

  it("should insert org branding when it does not exist", async () => {
    ;(mockDb.query.org_branding.findFirst as any) = mock(() =>
      Promise.resolve(null)
    )

    const newBranding = {
      org_id: "org-1",
      app_name: "New App",
      logo_url: null,
      primary_color: null,
      favicon_url: null,
      created_at: new Date(),
      updated_at: new Date(),
    }

    const insertMock = mock(() => ({
      values: mock(() => ({
        returning: mock(() => Promise.resolve([newBranding])),
      })),
    }))

    ;(mockDb.insert as any) = insertMock

    const result = await upsertOrgBranding(mockDb, "org-1", {
      app_name: "New App",
    })

    expect(result.org_id).toBe("org-1")
  })

  it("should delete org branding", async () => {
    const deleteMock = mock(() => ({
      where: mock(() => Promise.resolve(undefined)),
    }))

    ;(mockDb.delete as any) = deleteMock

    await deleteOrgBranding(mockDb, "org-1")
    expect(deleteMock).toHaveBeenCalled()
  })
})
