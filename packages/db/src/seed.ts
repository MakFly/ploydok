// SPDX-License-Identifier: AGPL-3.0-only
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import { createDb } from './client';
import { users, projects, backup_codes } from './schema';

// Dev-only fixed backup code used by scripts/run-dod.ts default login.
// Safe to commit: only works on local seed data. Never valid in prod.
export const DEV_BACKUP_CODE = 'DEVD-EVDE-VDEV';

// Seed picks DATABASE_URL from apps/api/.env.local when not already set, so
// `make db-seed` hits the real dev Postgres (port 5434, generated password)
// without requiring the user to export the URL manually.
if (!Bun.env['DATABASE_URL']) {
  try {
    const envFile = Bun.file(join(import.meta.dir, '../../../apps/api/.env.local'));
    if (await envFile.exists()) {
      const text = await envFile.text();
      const match = text.match(/^DATABASE_URL=(.*)$/m);
      if (match) Bun.env['DATABASE_URL'] = match[1]!.trim();
    }
  } catch {
    // Ignore — fall through to hardcoded default.
  }
}
const DB_URL = Bun.env['DATABASE_URL'] ?? 'postgres://ploydok:ploydok@127.0.0.1:5434/ploydok';
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

const codeHash = await bcrypt.hash(DEV_BACKUP_CODE, 10);
await db.insert(backup_codes).values({
  id: 'dev-backup-0001',
  user_id: 'dev-user-0001',
  code_hash: codeHash,
  consumed_at: null,
  created_at: now,
}).onConflictDoNothing();

console.log(`Seed complete: 1 user + 1 project + 1 backup code (dev@ploydok.local / ${DEV_BACKUP_CODE})`);
