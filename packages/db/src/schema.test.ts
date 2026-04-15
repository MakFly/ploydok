// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, beforeAll } from 'bun:test';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { createDb } from './client';
import { users, sessions } from './schema';

const MIGRATIONS_DIR = join(import.meta.dir, '../migrations');

describe('FK cascade: sessions deleted when user deleted', () => {
  const db = createDb(':memory:');

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
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
    });

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
    });

    const sessionsBefore = await db
      .select()
      .from(sessions)
      .where(eq(sessions.user_id, 'cascade-user-001'));
    expect(sessionsBefore).toHaveLength(1);

    await db.delete(users).where(eq(users.id, 'cascade-user-001'));

    const sessionsAfter = await db
      .select()
      .from(sessions)
      .where(eq(sessions.user_id, 'cascade-user-001'));
    expect(sessionsAfter).toHaveLength(0);
  });
});
