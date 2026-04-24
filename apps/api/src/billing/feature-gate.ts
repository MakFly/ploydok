// SPDX-License-Identifier: AGPL-3.0-only
import type { MiddlewareHandler } from "hono"
import type { Db } from "@ploydok/db"
import { hasFeature, hasQuota, getActiveLicense } from "@ploydok/db/queries"
import type { FeatureKey, QuotaKey } from "@ploydok/shared"

const ENTERPRISE_LICENSE_FEATURES: ReadonlySet<FeatureKey> =
  new Set<FeatureKey>([
    "sso",
    "whitelabel",
    "caddy_override",
    "audit_logs",
    "s3_backups",
    "custom_license",
  ])

const PRO_LICENSE_FEATURES: ReadonlySet<FeatureKey> = new Set<FeatureKey>([
  "caddy_override",
  "audit_logs",
  "s3_backups",
])

/**
 * Check if an active self-hosted license grants the feature, overriding the
 * per-org billing plan. Returns null if there is no license (caller falls back
 * to the regular per-plan check).
 */
async function licenseGrants(
  db: Db,
  feature: FeatureKey
): Promise<boolean | null> {
  const license = await getActiveLicense(db).catch(() => null)
  if (!license) return null
  const now = Date.now()
  if (license.expires_at && license.expires_at.getTime() < now) return null
  if (license.plan === "enterprise")
    return ENTERPRISE_LICENSE_FEATURES.has(feature)
  if (license.plan === "pro") return PRO_LICENSE_FEATURES.has(feature)
  return null
}

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

    const licenseOverride = await licenseGrants(db, feature)
    const hasAccess =
      licenseOverride === true
        ? true
        : await hasFeature(db, orgIdentifier, feature)

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
