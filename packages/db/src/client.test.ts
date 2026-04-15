// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, beforeAll } from 'bun:test';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { createDb } from './client';
import { users } from './schema';

const MIGRATIONS_DIR = join(import.meta.dir, '../migrations');

describe('createDb + users CRUD', () => {
  const db = createDb(':memory:');

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  });

  it('inserts and retrieves a user', async () => {
    const now = new Date();

    await db.insert(users).values({
      id: 'test-user-001',
      email: 'test@example.com',
      display_name: 'Test User',
      created_at: now,
      updated_at: now,
      recovery_token_hash: null,
      recovery_expires_at: null,
    });

    const rows = await db
      .select()
      .from(users)
      .where(eq(users.id, 'test-user-001'));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe('test@example.com');
    expect(rows[0]?.display_name).toBe('Test User');
  });

  it('deletes a user', async () => {
    await db.delete(users).where(eq(users.id, 'test-user-001'));

    const rows = await db
      .select()
      .from(users)
      .where(eq(users.id, 'test-user-001'));

    expect(rows).toHaveLength(0);
  });
});
