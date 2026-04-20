// SPDX-License-Identifier: AGPL-3.0-only
/**
 * client.test.ts — createDb + users CRUD
 *
 * Requires a Postgres instance. Set PLOYDOK_TEST_PG_URL or this test will skip.
 * Example: PLOYDOK_TEST_PG_URL=postgres://ploydok:ploydok@127.0.0.1:5432/ploydok_test bun test
 */
import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { eq } from 'drizzle-orm';
import { createDb } from './client';
import { users } from './schema';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { join } from 'node:path';

const PG_URL = Bun.env['PLOYDOK_TEST_PG_URL'];
const MIGRATIONS_DIR = join(import.meta.dir, '../migrations');

const skip = !PG_URL;
if (skip) {
  console.log('[client.test] PLOYDOK_TEST_PG_URL not set — skipping Postgres tests');
}

describe.skipIf(skip)('createDb + users CRUD', () => {
  const db = createDb(PG_URL!);
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    sql = postgres(PG_URL!, { max: 1 });
    const migDb = drizzle(sql);
    await migrate(migDb, { migrationsFolder: MIGRATIONS_DIR });
  });

  afterAll(async () => {
    await sql.end();
  });

  it('inserts and retrieves a user', async () => {
    const now = new Date();

    await db.insert(users).values({
      id: 'test-client-001',
      email: 'test-client@example.com',
      display_name: 'Test User',
      created_at: now,
      updated_at: now,
      recovery_token_hash: null,
      recovery_expires_at: null,
    }).onConflictDoNothing();

    const rows = await db
      .select()
      .from(users)
      .where(eq(users.id, 'test-client-001'));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe('test-client@example.com');
    expect(rows[0]?.display_name).toBe('Test User');
  });

  it('deletes a user', async () => {
    await db.delete(users).where(eq(users.id, 'test-client-001'));

    const rows = await db
      .select()
      .from(users)
      .where(eq(users.id, 'test-client-001'));

    expect(rows).toHaveLength(0);
  });
});
