// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import type { Context } from "hono"
import { getSharedAgent } from "../debug/singletons"
import { childLogger } from "../logger"

const log = childLogger("audit.pubkey")

export const auditPubkeyRouter = new Hono()

/**
 * GET /instance/audit-pubkey
 *
 * Returns the public key used to verify audit log signatures.
 * Public endpoint (no auth required).
 * Returns { pubkey: "<base64url>", key_id: "kid-..." }
 *
 * Responds 503 if agent is unavailable.
 */
auditPubkeyRouter.get("/audit-pubkey", async (c: Context) => {
  try {
    const agent = getSharedAgent()
    const { pubkey, keyId } = await agent.getAuditPubkey("")

    const pubkeyB64url = Buffer.from(pubkey).toString("base64url")

    return c.json({
      pubkey: pubkeyB64url,
      key_id: keyId,
    })
  } catch (err) {
    log.error({ err }, "failed to fetch audit pubkey")
    throw new HTTPException(503, {
      message: "Audit signing service unavailable",
    })
  }
})
