// SPDX-License-Identifier: AGPL-3.0-only
import type { Db } from "@ploydok/db"
import { getActiveLicense } from "@ploydok/db/queries"
import { logger } from "../logger"

/**
 * Check at boot if a license is active and log its status.
 * Non-blocking — errors are logged but do not stop boot.
 *
 * TODO: Lead must wire this into feature-gate.ts to override hasFeature() when
 * license plan is "enterprise". Helper getActiveLicense(db) is exported below.
 */
export async function verifyLicenseAtBoot(db: Db): Promise<void> {
  try {
    const license = await getActiveLicense(db)

    if (!license) {
      logger.debug("No active license found")
      return
    }

    const now = new Date()
    const expiresAt = new Date(license.expires_at)
    const isExpired = expiresAt < now

    if (isExpired) {
      logger.warn(
        {
          license_id: license.license_id,
          plan: license.plan,
          expired_at: license.expires_at.toISOString(),
        },
        "Active license has expired"
      )
      return
    }

    const daysUntilExpiry = Math.ceil(
      (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    )

    logger.info(
      {
        license_id: license.license_id,
        plan: license.plan,
        seats: license.seats,
        days_until_expiry: daysUntilExpiry,
      },
      "Active license verified"
    )
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : "unknown error" },
      "Failed to verify license at boot"
    )
  }
}

/**
 * Export getActiveLicense for use by feature-gate.ts override logic.
 * This allows checking if an instance-wide license is active and applying
 * its plan to all organizations.
 *
 * Usage in feature-gate.ts:
 *   const license = await getActiveLicense(db)
 *   if (license && license.plan === "enterprise") {
 *     return true // enterprise orgs get all features
 *   }
 */
export { getActiveLicense }
