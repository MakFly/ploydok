// SPDX-License-Identifier: AGPL-3.0-only
import type { Context, MiddlewareHandler } from "hono"
import type { Db } from "@ploydok/db"
import { insertAuditLog } from "@ploydok/db/queries"
import { childLogger } from "../logger"

const auditLog = childLogger("audit")

export interface AuditMiddlewareOptions {
  action: string
  targetType: string
  extractTargetId: (c: Context) => string | undefined
  extractOrgId?: (c: Context) => string | undefined
  extractMetadata?: (c: Context) => Record<string, unknown> | undefined
}

/**
 * Middleware that automatically logs mutations to the audit table.
 * Calls next() first, then if the response is 2xx, inserts an audit log entry.
 * Errors in audit insertion are logged but don't break the response.
 */
export function auditMiddleware(
  db: Db,
  opts: AuditMiddlewareOptions
): MiddlewareHandler {
  return async (c: Context, next) => {
    await next()

    const status = c.res.status
    if (status < 200 || status >= 300) {
      return
    }

    try {
      const user = c.get("user")
      const targetId = opts.extractTargetId(c)
      const orgId = opts.extractOrgId?.(c)
      const metadata = opts.extractMetadata?.(c)

      if (!targetId) {
        return
      }

      // TODO: wire hash-chain — compute SHA256(prev_hash || JSON.stringify(entry)) and lookup the previous entry
      const success = await insertAuditLog(db, {
        user_id: user?.id ?? null,
        action: opts.action,
        target_type: opts.targetType,
        target_id: targetId,
        metadata: metadata ? JSON.stringify(metadata) : "{}",
        created_at: new Date(),
      })

      if (!success) {
        auditLog.warn(
          { action: opts.action, targetType: opts.targetType, targetId },
          "failed to insert audit log"
        )
      }
    } catch (err) {
      auditLog.warn(
        { err, action: opts.action, targetType: opts.targetType },
        "error in audit middleware"
      )
    }
  }
}
