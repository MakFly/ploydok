// SPDX-License-Identifier: AGPL-3.0-only
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { join } from 'node:path';
import { createDb } from './client';
import { users, projects } from './schema';

const DB_URL = Bun.env['DATABASE_URL'] ?? 'postgres://ploydok:ploydok@127.0.0.1:5432/ploydok';
const MIGRATIONS_DIR = join(import.meta.dir, '../migrations');

// Run migrations first
const migSql = postgres(DB_URL, { max: 1 });
await migrate(drizzle(migSql), { migrationsFolder: MIGRATIONS_DIR });
await migSql.end();

const db = createDb(DB_URL);

const now = new Date();

await db.insert(users).values({
  id: 'dev-user-0001',
  email: 'dev@ploydok.local',
  display_name: 'Dev',
  created_at: now,
  updated_at: now,
  recovery_token_hash: null,
  recovery_expires_at: null,
}).onConflictDoNothing();

await db.insert(projects).values({
  id: 'dev-project-0001',
  owner_id: 'dev-user-0001',
  name: 'Default',
  slug: 'default',
  created_at: now,
}).onConflictDoNothing();

console.log('Seed complete: 1 user + 1 project inserted (dev@ploydok.local)');
