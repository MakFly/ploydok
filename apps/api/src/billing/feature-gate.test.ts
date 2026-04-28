// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, mock } from "bun:test"
import { requireFeature, checkQuota } from "./feature-gate"
import type { Db } from "@ploydok/db"

describe("feature-gate", () => {
  describe("requireFeature middleware", () => {
    it("returns 403 when feature is not available", async () => {
      const mockDb = {
        query: {
          org_subscriptions: {
            findFirst: mock(() => null),
          },
          billing_plans: {
            findFirst: mock(() => ({
              slug: "free",
              features: {
                sso: false,
                whitelabel: false,
                caddy_override: false,
                audit_logs: true,
                s3_backups: true,
              },
              quotas: {
                apps_count: 3,
                services_count: 3,
                members_count: 3,
              },
            })),
          },
        },
      } as unknown as Db

      const middleware = requireFeature(mockDb, "sso")

      let jsonCalled = false
      const mockC = {
        req: {
          param: mock((name: string) => {
            if (name === "slug") return "org-123"
            return undefined
          }),
        },
        json: mock((data: any, options: any) => {
          jsonCalled = true
          return { data, options }
        }),
      } as any

      await middleware(mockC, async () => {})

      expect(jsonCalled).toBe(true)
    })

    it("calls next() when feature is available", async () => {
      const mockDb = {
        query: {
          org_subscriptions: {
            findFirst: mock(() => null),
          },
          billing_plans: {
            findFirst: mock(() => ({
              slug: "free",
              features: {
                sso: false,
                whitelabel: false,
                caddy_override: false,
                audit_logs: true,
                s3_backups: true,
              },
              quotas: {
                apps_count: 3,
                services_count: 3,
                members_count: 3,
              },
            })),
          },
        },
      } as unknown as Db

      const middleware = requireFeature(mockDb, "audit_logs")

      let nextCalled = false
      const mockC = {
        req: {
          param: mock((name: string) => {
            if (name === "slug") return "org-123"
            return undefined
          }),
        },
      } as any

      await middleware(mockC, async () => {
        nextCalled = true
      })

      expect(nextCalled).toBe(true)
    })
  })

  describe("checkQuota", () => {
    it("returns true when usage is below limit", async () => {
      const mockDb = {
        query: {
          org_subscriptions: {
            findFirst: mock(() => null),
          },
          billing_plans: {
            findFirst: mock(() => ({
              slug: "free",
              features: {
                sso: false,
                whitelabel: false,
                caddy_override: false,
                audit_logs: true,
                s3_backups: true,
              },
              quotas: {
                apps_count: 3,
                services_count: 3,
                members_count: 3,
              },
            })),
          },
        },
      } as unknown as Db

      const result = await checkQuota(mockDb, "org-123", "apps_count", 2)
      expect(result).toBe(true)
    })

    it("returns false when usage meets limit", async () => {
      const mockDb = {
        query: {
          org_subscriptions: {
            findFirst: mock(() => null),
          },
          billing_plans: {
            findFirst: mock(() => ({
              slug: "free",
              features: {
                sso: false,
                whitelabel: false,
                caddy_override: false,
                audit_logs: true,
                s3_backups: true,
              },
              quotas: {
                apps_count: 3,
                services_count: 3,
                members_count: 3,
              },
            })),
          },
        },
      } as unknown as Db

      const result = await checkQuota(mockDb, "org-123", "apps_count", 3)
      expect(result).toBe(false)
    })
  })
})
