// SPDX-License-Identifier: AGPL-3.0-only
import { eq } from "drizzle-orm";
import type { Db } from "../client";
import { users } from "../schema";

export async function findUserByEmail(db: Db, email: string) {
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0] ?? null;
}

export async function findUserById(db: Db, id: string) {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}
