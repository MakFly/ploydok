// SPDX-License-Identifier: AGPL-3.0-only
import { pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { users } from "./users"

/**
 * TOTP secret per user. Max 1 row per user (user_id is UNIQUE).
 *
 * `secret_encrypted` stores the TOTP secret encrypted with MASTER_KEY
 * via AES-GCM (same pattern as `secrets` table). Never stored in plaintext.
 *
 * `verified_at` is set once the user confirms their first TOTP code
 * post-enrollment. Unverified rows are ignored by `requireSecondFactor`.
 */
export const totp_secrets = pgTable("totp_secrets", {
  id: text("id").primaryKey(),
  user_id: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  secret_encrypted: text("secret_encrypted").notNull(),
  verified_at: timestamp("verified_at", { withTimezone: true, mode: "date" }),
  created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .$defaultFn(() => new Date()),
})
