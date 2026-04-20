// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Test DB helpers — creates a Postgres DB for unit/integration tests.
 *
 * Usage pattern:
 *   const { db, cleanup } = await makeTestDb();
 *   // ... tests ...
 *   await cleanup();
 *
 * Set PLOYDOK_TEST_PG_URL to enable. If absent, returns a sentinel
 * that throws on use — combine with describe.skipIf(!PLOYDOK_TEST_PG_URL).
 */
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { createDb } from "@ploydok/db"
import type { Db } from "@ploydok/db"

const here = fileURLToPath(new URL(".", import.meta.url))
// packages/db/migrations relative to apps/api/src/test/
const MIGRATIONS_DIR = join(here, "../../../../packages/db/migrations")

export const TEST_PG_URL = Bun.env["PLOYDOK_TEST_PG_URL"]

let _migrated = false

/**
 * Creates a Drizzle Postgres DB for tests.
 * Applies migrations once per process (idempotent).
 * Returns cleanup function to close the connection.
 */
export async function makeTestDb(): Promise<{ db: Db; cleanup: () => Promise<void> }> {
  if (!TEST_PG_URL) {
    throw new Error(
      "[test] PLOYDOK_TEST_PG_URL not set — cannot create test DB. Set it and retry.",
    )
  }

  if (!_migrated) {
    const migSql = postgres(TEST_PG_URL, { max: 1 })
    await migrate(drizzle(migSql), { migrationsFolder: MIGRATIONS_DIR })
    await migSql.end()
    _migrated = true
  }

  const db = createDb(TEST_PG_URL)

  return {
    db,
    async cleanup() {
      // postgres-js closes connections lazily; no explicit close needed per-test.
      // The pool will be GC'd when the test process exits.
    },
  }
}
