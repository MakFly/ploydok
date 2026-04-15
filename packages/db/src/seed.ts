// SPDX-License-Identifier: AGPL-3.0-only
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { join } from 'node:path';
import { createDb } from './client';
import { users, projects } from './schema';

const DB_PATH = process.env['DB_PATH'] ?? join(import.meta.dir, '../../dev.db');
const MIGRATIONS_DIR = join(import.meta.dir, '../migrations');

const db = createDb(DB_PATH);

await migrate(db, { migrationsFolder: MIGRATIONS_DIR });

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
