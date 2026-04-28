// SPDX-License-Identifier: AGPL-3.0-only
import { eq } from "drizzle-orm"
import type { Context, Next } from "hono"
import { users, type Db } from "@ploydok/db"
import type { AuthUser } from "./middleware"

export async function isInstanceAdmin(
  db: Db,
  userId: string
): Promise<boolean> {
  const rows = await db
    .select({ is_instance_admin: users.is_instance_admin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  return rows[0]?.is_instance_admin === true
}

export function requireInstanceAdmin(db: Db) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const user = c.get("user") as AuthUser | undefined
    if (!user) return c.json({ error: "Unauthorized" }, 401)

    if (!(await isInstanceAdmin(db, user.id))) {
      return c.json({ error: "admin_required" }, 403)
    }

    await next()
  }
}
