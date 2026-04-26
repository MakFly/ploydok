// SPDX-License-Identifier: AGPL-3.0-only
import { resolveTxt } from "node:dns/promises"
import { eq } from "drizzle-orm"
import { domains } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { childLogger } from "../logger.js"

const log = childLogger("domain-verifier")

export interface VerifyResult {
  ok: boolean
  reason?: string
}

type ResolveTxtFn = (hostname: string) => Promise<string[][]>

export async function verifyDomain(
  db: Db,
  domainId: string,
  resolveTxtFn: ResolveTxtFn = resolveTxt,
): Promise<VerifyResult> {
  const rows = await db.select().from(domains).where(eq(domains.id, domainId)).limit(1)
  const domain = rows[0]
  if (!domain) {
    return { ok: false, reason: "domain not found" }
  }

  if (!domain.verify_token) {
    return { ok: false, reason: "no verify_token set" }
  }

  const verificationHost = domain.hostname.replace(/^\*\./, "")
  const lookupName = `_ploydok-verify.${verificationHost}`
  log.debug({ domainId, lookupName }, "resolving TXT record")

  let records: string[][]
  try {
    records = await resolveTxtFn(lookupName)
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === "ENOTFOUND" || code === "ENODATA") {
      return { ok: false, reason: "TXT record not found" }
    }
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: `DNS lookup error: ${msg}` }
  }

  const flat = records.flatMap((r) => r)
  const matched = flat.some((v) => v === domain.verify_token)

  if (matched) {
    log.info({ domainId, hostname: domain.hostname }, "domain verified")
    return { ok: true }
  }

  return {
    ok: false,
    reason: `TXT record found but token did not match (found: ${flat.slice(0, 3).join(", ")})`,
  }
}
