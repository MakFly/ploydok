// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, mock } from "bun:test"
import type { Db } from "../client"
import { getActiveLicense, activateLicense } from "./license"

describe("license queries", () => {
  it("getActiveLicense returns null when no license exists", async () => {
    const mockDb = {
      query: {
        instance_license: {
          findFirst: mock(async () => null),
        },
      },
    } as unknown as Db

    const result = await getActiveLicense(mockDb)
    expect(result).toBeNull()
  })

  it("getActiveLicense returns license row when found", async () => {
    const mockLicense = {
      id: "default",
      license_id: "test-uuid",
      plan: "pro" as const,
      seats: 5,
      expires_at: new Date("2025-12-31"),
      activated_at: new Date(),
      activated_by: "user123",
      jwt: "token",
    }

    const mockDb = {
      query: {
        instance_license: {
          findFirst: mock(async () => mockLicense),
        },
      },
    } as unknown as Db

    const result = await getActiveLicense(mockDb)
    expect(result).toEqual(mockLicense)
  })

  it("activateLicense inserts new license when none exists", async () => {
    const newData = {
      license_id: "new-uuid",
      plan: "enterprise" as const,
      seats: 10,
      expires_at: new Date("2025-12-31"),
      activated_by: "user456",
      jwt: "new-token",
    }

    const insertedLicense = {
      id: "default",
      ...newData,
      activated_at: new Date(),
    }

    const mockDb = {
      query: {
        instance_license: {
          findFirst: mock(async () => null),
        },
      },
      insert: mock(() => ({
        values: mock(() => ({
          returning: mock(async () => [insertedLicense]),
        })),
      })),
    } as unknown as Db

    const result = await activateLicense(mockDb, newData)
    expect(result).toEqual(insertedLicense)
  })

  it("activateLicense updates existing license", async () => {
    const existingLicense = {
      id: "default",
      license_id: "old-uuid",
      plan: "pro" as const,
      seats: 5,
      expires_at: new Date("2024-12-31"),
      activated_at: new Date("2023-01-01"),
      activated_by: "user123",
      jwt: "old-token",
    }

    const newData = {
      license_id: "new-uuid",
      plan: "enterprise" as const,
      seats: 10,
      expires_at: new Date("2025-12-31"),
      activated_by: "user456",
      jwt: "new-token",
    }

    const updatedLicense = {
      ...existingLicense,
      ...newData,
      activated_at: new Date(),
    }

    const mockDb = {
      query: {
        instance_license: {
          findFirst: mock(async () => existingLicense),
        },
      },
      update: mock(() => ({
        set: mock(() => ({
          where: mock(() => ({
            returning: mock(async () => [updatedLicense]),
          })),
        })),
      })),
    } as unknown as Db

    const result = await activateLicense(mockDb, newData)
    expect(result.license_id).toBe("new-uuid")
    expect(result.plan).toBe("enterprise")
  })
})
