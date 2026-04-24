// SPDX-License-Identifier: AGPL-3.0-only
import { eq, sql } from "drizzle-orm"
import { notification_read_state } from "../schema"
import type { Db } from "../client"

export async function getReadState(db: Db, userId: string): Promise<Date | null> {
  const [row] = await db
    .select({ last_read_at: notification_read_state.last_read_at })
    .from(notification_read_state)
    .where(eq(notification_read_state.user_id, userId))
    .limit(1)

  return row?.last_read_at ?? null
}

export async function markNotificationsRead(
  db: Db,
  userId: string,
  at: Date,
): Promise<void> {
  await db
    .insert(notification_read_state)
    .values({
      user_id: userId,
      last_read_at: at,
      updated_at: new Date(),
    })
    .onConflictDoUpdate({
      target: notification_read_state.user_id,
      set: {
        last_read_at: at,
        updated_at: sql`now()`,
      },
    })
}
