-- SPDX-License-Identifier: AGPL-3.0-only

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "password_hash" text;
