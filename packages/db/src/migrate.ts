// SPDX-License-Identifier: AGPL-3.0-only
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const url = Bun.env['DATABASE_URL'] ?? '../../ploydok.db';
const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(here, '..', 'migrations');

const sqlite = new Database(url);
sqlite.exec('PRAGMA foreign_keys = ON;');
const db = drizzle(sqlite);

console.log(`[migrate] applying migrations from ${migrationsFolder} to ${url}`);
migrate(db, { migrationsFolder });
console.log('[migrate] done');
