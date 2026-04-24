// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach, mock } from "bun:test"
import type { Db } from "../client"
import {
  getSSOConfigByOrgId,
  createSSOConfig,
  updateSSOConfig,
  deleteSSOConfig,
} from "./sso-configs"

describe("sso-configs queries", () => {
  let mockDb: Db
  const orgId = "org-123"
  const sampleConfig = {
    id: "sso-1",
    org_id: orgId,
    issuer: "https://idp.example.com",
    client_id: "client-id",
    client_secret_enc: Buffer.from("encrypted-secret"),
    client_secret_nonce: Buffer.from("nonce"),
    redirect_uri: "https://app.example.com/callback",
    scopes: "openid email profile",
    enabled: false,
    created_at: new Date(),
    updated_at: new Date(),
  }

  beforeEach(() => {
    mockDb = {
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => ({
            limit: mock(() => Promise.resolve([sampleConfig])),
          })),
        })),
      })),
      insert: mock(() => ({
        values: mock(() => ({
          returning: mock(() => Promise.resolve([sampleConfig])),
        })),
      })),
      update: mock(() => ({
        set: mock(() => ({
          where: mock(() => ({
            returning: mock(() => Promise.resolve([sampleConfig])),
          })),
        })),
      })),
      delete: mock(() => ({
        where: mock(() => Promise.resolve()),
      })),
    } as unknown as Db
  })

  it("getSSOConfigByOrgId returns config if found", async () => {
    const result = await getSSOConfigByOrgId(mockDb, orgId)
    expect(result).toEqual(sampleConfig)
  })

  it("getSSOConfigByOrgId returns null if not found", async () => {
    mockDb = {
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => ({
            limit: mock(() => Promise.resolve([])),
          })),
        })),
      })),
    } as unknown as Db

    const result = await getSSOConfigByOrgId(mockDb, orgId)
    expect(result).toBeNull()
  })

  it("createSSOConfig inserts and returns config", async () => {
    const newConfig = { ...sampleConfig }
    const result = await createSSOConfig(mockDb, newConfig)
    expect(result).toEqual(sampleConfig)
  })

  it("updateSSOConfig updates and returns config", async () => {
    const updates = { enabled: true }
    const result = await updateSSOConfig(mockDb, orgId, updates)
    expect(result).toEqual(sampleConfig)
  })

  it("deleteSSOConfig calls delete", async () => {
    await deleteSSOConfig(mockDb, orgId)
    expect(mockDb.delete).toHaveBeenCalled()
  })
})
