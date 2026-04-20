// SPDX-License-Identifier: AGPL-3.0-only
/**
 * schema.test.ts — FK cascade tests on Postgres
 *
 * Requires PLOYDOK_TEST_PG_URL — skipped if absent.
 */
import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { eq } from 'drizzle-orm';
import { createDb } from './client';
import { users, sessions } from './schema';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { join } from 'node:path';

const PG_URL = Bun.env['PLOYDOK_TEST_PG_URL'];
const MIGRATIONS_DIR = join(import.meta.dir, '../migrations');

const skip = !PG_URL;
if (skip) {
  console.log('[schema.test] PLOYDOK_TEST_PG_URL not set — skipping Postgres tests');
}

describe.skipIf(skip)('FK cascade: sessions deleted when user deleted', () => {
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

  it('cascades session deletion on user delete', async () => {
    const now = new Date();
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await db.insert(users).values({
      id: 'cascade-user-001',
      email: 'cascade@example.com',
      display_name: 'Cascade User',
      created_at: now,
      updated_at: now,
      recovery_token_hash: null,
      recovery_expires_at: null,
    }).onConflictDoNothing();

    await db.insert(sessions).values({
      id: 'cascade-session-001',
      user_id: 'cascade-user-001',
      refresh_token_hash: 'deadbeef',
      user_agent: 'Mozilla/5.0',
      ip: '127.0.0.1',
      created_at: now,
      last_seen_at: now,
      revoked_at: null,
      expires_at: future,
    }).onConflictDoNothing();

    const sessionsBefore = await db
      .select()
      .from(sessions)
      .where(eq(sessions.user_id, 'cascade-user-001'));
    expect(sessionsBefore.length).toBeGreaterThanOrEqual(1);

    await db.delete(users).where(eq(users.id, 'cascade-user-001'));

    const sessionsAfter = await db
      .select()
      .from(sessions)
      .where(eq(sessions.user_id, 'cascade-user-001'));
    expect(sessionsAfter).toHaveLength(0);
  });
});
