// SPDX-License-Identifier: AGPL-3.0-only
import type { Context, MiddlewareHandler } from "hono"
import type { Db } from "@ploydok/db"
import type { Agent } from "../agent"
import { insertAuditLogSigned } from "@ploydok/db/queries"
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
 * Signs each entry via agent.signAuditEntry().
 * If signing fails or agent is unavailable, logs a warning and writes signature=NULL.
 * Errors in audit insertion are logged but don't break the response.
 */
export function auditMiddleware(
  db: Db,
  agent: Agent,
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

      const signFn = async (
        canonical: Uint8Array
      ): Promise<{ signature: string; keyId: string } | null> => {
        try {
          const { signature, keyId } = await agent.signAuditEntry(canonical, "")
          const sig = Buffer.from(signature).toString("base64url")
          return { signature: sig, keyId }
        } catch (err) {
          auditLog.warn(
            { err, action: opts.action, targetType: opts.targetType, targetId },
            "agent sign failed, writing unsigned entry"
          )
          return null
        }
      }

      const row = await insertAuditLogSigned(
        db,
        {
          user_id: user?.id ?? null,
          action: opts.action,
          target_type: opts.targetType,
          target_id: targetId,
          metadata: metadata ? JSON.stringify(metadata) : "{}",
          created_at: new Date(),
          org_id: orgId ?? null,
        },
        signFn
      )

      if (!row) {
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
