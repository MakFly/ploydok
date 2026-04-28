// SPDX-License-Identifier: AGPL-3.0-only
import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core"
import { users } from "./users"

export const audit_log = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    user_id: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    target_type: text("target_type").notNull(),
    target_id: text("target_id").notNull(),
    metadata: text("metadata").notNull().default("{}"),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    prev_hash: text("prev_hash"),
    hash: text("hash"),
    signature: text("signature"),
    key_id: text("key_id"),
    org_id: text("org_id"),
  },
  (t) => ({
    orgCreatedIdx: index("idx_audit_log_org_created").on(
      t.org_id,
      t.created_at
    ),
  })
)

export const audit_anchors = pgTable(
  "audit_anchors",
  {
    id: serial("id").primaryKey(),
    head_audit_id: integer("head_audit_id").notNull(),
    head_hash: text("head_hash").notNull(),
    signature: text("signature").notNull(),
    key_id: text("key_id").notNull(),
    signed_at: timestamp("signed_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (t) => ({
    signedAtIdx: index("idx_audit_anchors_signed_at").on(t.signed_at),
  })
)
