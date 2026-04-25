// SPDX-License-Identifier: AGPL-3.0-only
import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core"
import { users } from "./users"

export const api_tokens = pgTable(
  "api_tokens",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    token_hash: text("token_hash").notNull(),
    /**
     * bcrypt hash du token complet — défense-in-depth si la DB fuit.
     * NULL = token legacy (créé avant Sprint 6.5-bis Vague 2), authentifié par
     * lookup SHA-256 seul. Tokens créés à partir de la Vague 2 ont bcrypt_hash
     * non-NULL et le verify bcrypt est obligatoire en plus du lookup.
     */
    bcrypt_hash: text("bcrypt_hash"),
    scopes: jsonb("scopes").$type<string[]>().notNull().default(["admin:*"]),
    last_used_at: timestamp("last_used_at", {
      withTimezone: true,
      mode: "date",
    }),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    expires_at: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    revoked_at: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [uniqueIndex("api_tokens_token_hash_unique").on(table.token_hash)]
)

export type ApiTokenRow = typeof api_tokens.$inferSelect
export type ApiTokenInsert = typeof api_tokens.$inferInsert
