// SPDX-License-Identifier: AGPL-3.0-only
import type { MiddlewareHandler } from "hono"
import type { Db } from "@ploydok/db"
import { hasFeature, hasQuota } from "@ploydok/db/queries"
import type { FeatureKey, QuotaKey } from "@ploydok/shared"

/**
 * Middleware that checks if an organization has a feature enabled.
 * Extracts org ID from route params (slug or orgId) and resolves to project ID.
 *
 * Returns 403 Forbidden if the feature is not included in the org's plan.
 */
export function requireFeature(db: Db, feature: FeatureKey): MiddlewareHandler {
  return async (c, next) => {
    const slug = c.req.param("slug")
    const orgId = c.req.param("orgId")

    if (!slug && !orgId) {
      return c.json(
        { error: "Missing organization identifier" },
        { status: 400 }
      )
    }

    const orgIdentifier = slug || orgId
    if (!orgIdentifier) {
      return c.json(
        { error: "Missing organization identifier" },
        { status: 400 }
      )
    }

    const hasAccess = await hasFeature(db, orgIdentifier, feature)

    if (!hasAccess) {
      return c.json(
        {
          error: `Feature ${feature} is not available in your plan`,
          feature,
        },
        { status: 403 }
      )
    }

    await next()
  }
}

/**
 * Check if an organization is within quota for a specific limit.
 *
 * @param db Database instance
 * @param orgId Organization ID
 * @param quota Quota key to check
 * @param currentUsage Current usage count (caller's responsibility to count)
 * @returns true if organization is within quota, false otherwise
 */
export async function checkQuota(
  db: Db,
  orgId: string,
  quota: QuotaKey,
  currentUsage: number
): Promise<boolean> {
  return hasQuota(db, orgId, quota, currentUsage)
}
