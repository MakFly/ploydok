// SPDX-License-Identifier: AGPL-3.0-only
//
// Exec ticket — one-shot ticket signed HMAC pour gater l'ouverture d'un
// terminal web (Sprint 6.5-ter).
//
// Flow:
//   1. Front appelle POST /apps/:id/exec/ticket?mode=ro|rw
//      → endpoint gated par requireAuth (mode=ro) ou requireTotpVerified
//        (mode=rw). Retourne { ticket, expiresAt }.
//   2. Front ouvre la WS /ws/apps/:id/exec?mode=...&ticket=...
//   3. Le handler WS appelle verifyExecTicket(ticket, userId, appId, mode).
//
// Format ticket : `<base64url(payload)>.<hex(HMAC-SHA256)>`
//   payload = JSON {user_id, app_id, mode, exp_ms, nonce}
//
// TTL court (60s) — anti-replay basique : nonce inclus dans la signature, pas
// de blacklist persistante (on accepte qu'un ticket peut être ré-utilisé dans
// sa fenêtre TTL — c'est OK, il est scopé user+app+mode).

import { createHmac, timingSafeEqual, randomBytes } from "node:crypto"
import { env } from "../env"

export type ExecMode = "ro" | "rw"

interface TicketPayload {
  user_id: string
  app_id: string
  mode: ExecMode
  exp_ms: number
  nonce: string
}

const TICKET_TTL_MS = 60_000

function sign(payload: string): string {
  const hmac = createHmac("sha256", env.SESSION_SECRET)
  hmac.update(payload)
  return hmac.digest("hex")
}

export function issueExecTicket(opts: {
  userId: string
  appId: string
  mode: ExecMode
}): { ticket: string; expiresAt: number } {
  const payload: TicketPayload = {
    user_id: opts.userId,
    app_id: opts.appId,
    mode: opts.mode,
    exp_ms: Date.now() + TICKET_TTL_MS,
    nonce: randomBytes(8).toString("hex"),
  }
  const json = JSON.stringify(payload)
  const b64 = Buffer.from(json, "utf8").toString("base64url")
  const sig = sign(b64)
  return { ticket: `${b64}.${sig}`, expiresAt: payload.exp_ms }
}

export interface VerifyResult {
  ok: boolean
  reason?:
    | "malformed"
    | "bad_signature"
    | "expired"
    | "user_mismatch"
    | "app_mismatch"
    | "mode_mismatch"
}

export function verifyExecTicket(
  ticket: string,
  expected: { userId: string; appId: string; mode: ExecMode }
): VerifyResult {
  const idx = ticket.indexOf(".")
  if (idx === -1) return { ok: false, reason: "malformed" }
  const b64 = ticket.slice(0, idx)
  const sig = ticket.slice(idx + 1)

  const expectedSig = sign(b64)
  let sigMatch = false
  try {
    const a = Buffer.from(sig, "hex")
    const b = Buffer.from(expectedSig, "hex")
    sigMatch = a.length === b.length && timingSafeEqual(a, b)
  } catch {
    sigMatch = false
  }
  if (!sigMatch) return { ok: false, reason: "bad_signature" }

  let payload: TicketPayload
  try {
    payload = JSON.parse(
      Buffer.from(b64, "base64url").toString("utf8")
    ) as TicketPayload
  } catch {
    return { ok: false, reason: "malformed" }
  }

  if (Date.now() > payload.exp_ms) return { ok: false, reason: "expired" }
  if (payload.user_id !== expected.userId)
    return { ok: false, reason: "user_mismatch" }
  if (payload.app_id !== expected.appId)
    return { ok: false, reason: "app_mismatch" }
  if (payload.mode !== expected.mode)
    return { ok: false, reason: "mode_mismatch" }

  return { ok: true }
}
