// SPDX-License-Identifier: AGPL-3.0-only
import { and, eq } from 'drizzle-orm';
import type { Db } from '../client';
import { registry_credentials } from '../schema';

export interface RegistryCredentialInsert {
  id: string;
  user_id: string;
  label: string;
  registry_host: string;
  username: string;
  password_enc: Buffer;
  password_nonce: Buffer;
}

export async function listRegistryCredentials(
  db: Db,
  userId: string,
): Promise<Array<typeof registry_credentials.$inferSelect>> {
  return db
    .select()
    .from(registry_credentials)
    .where(eq(registry_credentials.user_id, userId));
}

export async function getRegistryCredential(
  db: Db,
  userId: string,
  id: string,
): Promise<typeof registry_credentials.$inferSelect | null> {
  const rows = await db
    .select()
    .from(registry_credentials)
    .where(
      and(eq(registry_credentials.id, id), eq(registry_credentials.user_id, userId)),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function insertRegistryCredential(
  db: Db,
  cred: RegistryCredentialInsert,
): Promise<void> {
  await db.insert(registry_credentials).values(cred);
}

export async function deleteRegistryCredential(
  db: Db,
  userId: string,
  id: string,
): Promise<boolean> {
  const rows = await db
    .delete(registry_credentials)
    .where(
      and(eq(registry_credentials.id, id), eq(registry_credentials.user_id, userId)),
    )
    .returning({ id: registry_credentials.id });
  return rows.length > 0;
}
