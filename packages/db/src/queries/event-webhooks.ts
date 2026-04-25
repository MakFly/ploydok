// SPDX-License-Identifier: AGPL-3.0-only
import { eq, and } from "drizzle-orm"
import type { Db } from "../client"
import { eventWebhooks } from "../schema"

export async function listEventWebhooks(
  db: Db,
  orgId: string
): Promise<(typeof eventWebhooks.$inferSelect)[]> {
  return db.select().from(eventWebhooks).where(eq(eventWebhooks.org_id, orgId))
}

export async function getEventWebhook(
  db: Db,
  webhookId: string,
  orgId: string
): Promise<typeof eventWebhooks.$inferSelect | null> {
  const rows = await db
    .select()
    .from(eventWebhooks)
    .where(
      and(eq(eventWebhooks.id, webhookId), eq(eventWebhooks.org_id, orgId))
    )
    .limit(1)
  return rows[0] ?? null
}

export async function createEventWebhook(
  db: Db,
  webhook: typeof eventWebhooks.$inferInsert
): Promise<typeof eventWebhooks.$inferSelect> {
  const rows = await db.insert(eventWebhooks).values(webhook).returning()
  return rows[0]!
}

export async function updateEventWebhook(
  db: Db,
  webhookId: string,
  orgId: string,
  updates: Partial<typeof eventWebhooks.$inferInsert>
): Promise<typeof eventWebhooks.$inferSelect | null> {
  const rows = await db
    .update(eventWebhooks)
    .set(updates)
    .where(
      and(eq(eventWebhooks.id, webhookId), eq(eventWebhooks.org_id, orgId))
    )
    .returning()
  return rows[0] ?? null
}

export async function deleteEventWebhook(
  db: Db,
  webhookId: string,
  orgId: string
): Promise<boolean> {
  const webhook = await getEventWebhook(db, webhookId, orgId)
  if (!webhook) return false

  await db
    .delete(eventWebhooks)
    .where(
      and(eq(eventWebhooks.id, webhookId), eq(eventWebhooks.org_id, orgId))
    )
  return true
}

export async function listEnabledWebhooksForEvent(
  db: Db,
  orgId: string,
  event: string
): Promise<(typeof eventWebhooks.$inferSelect)[]> {
  return db
    .select()
    .from(eventWebhooks)
    .where(
      and(eq(eventWebhooks.org_id, orgId), eq(eventWebhooks.enabled, true))
    )
    .then((rows) => rows.filter((row) => row.events.includes(event)))
}
