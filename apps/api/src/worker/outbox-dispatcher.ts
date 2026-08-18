// SPDX-License-Identifier: AGPL-3.0-only
import type { Db } from "@ploydok/db"
import {
  claimNextOutboxEvent,
  completeOutboxEvent,
  deadLetterOutboxEvent,
  getPendingInvitationById,
  heartbeatOutboxEvent,
  retryOutboxEvent,
} from "@ploydok/db/queries"
import { decryptSecret } from "../secrets/crypto"
import { sendMailOrThrow, type SendMailInput } from "../mailer"
import { workerLog } from "./logger"

const log = workerLog.child({ subsystem: "outbox" })
const POLL_MS = 2_000
const SMTP_TIMEOUT_MS = 25_000
const SEND_LEASE_MS = 45_000
const HEARTBEAT_INTERVAL_MS = 10_000
const MAX_ATTEMPTS = 8
let timer: ReturnType<typeof setInterval> | null = null
let running = false

interface MailOutboxPayload extends SendMailInput {
  kind: "mail"
  invitationId: string
}

function parseMailPayload(value: string): MailOutboxPayload {
  const payload = JSON.parse(value) as Partial<MailOutboxPayload>
  if (
    payload.kind !== "mail" ||
    typeof payload.invitationId !== "string" ||
    typeof payload.to !== "string" ||
    typeof payload.subject !== "string" ||
    typeof payload.text !== "string"
  ) {
    throw new Error("Invalid mail outbox payload")
  }
  return payload as MailOutboxPayload
}

export async function dispatchOutboxOnce(
  db: Db,
  deps: {
    decrypt?: typeof decryptSecret
    send?: typeof sendMailOrThrow
    now?: Date
    leaseToken?: string
    clock?: () => Date
    smtpTimeoutMs?: number
    sendLeaseMs?: number
    heartbeatIntervalMs?: number
  } = {}
): Promise<"idle" | "delivered" | "retry" | "dead-letter"> {
  const now = deps.now ?? new Date()
  const claim = await claimNextOutboxEvent(db, {
    now,
    ...(deps.leaseToken ? { leaseToken: deps.leaseToken } : {}),
  })
  if (!claim) return "idle"

  try {
    if (claim.event.topic !== "mail.invitation") {
      throw new Error(`Unsupported outbox topic: ${claim.event.topic}`)
    }
    const decrypt = deps.decrypt ?? decryptSecret
    const plaintext = await decrypt(
      claim.event.payload_ciphertext,
      claim.event.payload_nonce
    )
    const payload = parseMailPayload(plaintext)
    const preSendNow = deps.clock?.() ?? new Date()
    if (
      claim.event.invitation_id !== payload.invitationId ||
      !(await getPendingInvitationById(db, payload.invitationId, preSendNow))
    ) {
      await deadLetterOutboxEvent(
        db,
        claim.event.id,
        claim.leaseToken,
        "Invitation revoked, accepted, or expired",
        preSendNow
      )
      return "dead-letter"
    }

    const controller = new AbortController()
    let sendStarted = false
    let heartbeatInFlight: Promise<boolean> | null = null
    let rejectLeaseLost!: (error: Error) => void
    const leaseLost = new Promise<never>((_, reject) => {
      rejectLeaseLost = reject
    })
    const heartbeat = () => {
      if (heartbeatInFlight) return heartbeatInFlight
      const heartbeatNow = deps.clock?.() ?? new Date()
      heartbeatInFlight = heartbeatOutboxEvent(
        db,
        claim.event.id,
        claim.leaseToken,
        heartbeatNow,
        deps.sendLeaseMs ?? SEND_LEASE_MS
      )
        .then((owned) => {
          if (!owned) {
            const error = new Error("Outbox lease lost during SMTP send")
            controller.abort(error)
            if (sendStarted) rejectLeaseLost(error)
          }
          return owned
        })
        .catch((cause: unknown) => {
          const error = new Error("Outbox heartbeat failed", { cause })
          controller.abort(error)
          if (sendStarted) rejectLeaseLost(error)
          return false
        })
        .finally(() => {
          heartbeatInFlight = null
        })
      return heartbeatInFlight
    }
    if (!(await heartbeat())) {
      throw new Error("Outbox lease lost before SMTP send")
    }

    const heartbeatTimer = setInterval(
      () => void heartbeat(),
      deps.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS
    )
    const send = deps.send ?? sendMailOrThrow
    sendStarted = true
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      const timedOut = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          const error = new Error("SMTP delivery timed out")
          controller.abort(error)
          reject(error)
        }, deps.smtpTimeoutMs ?? SMTP_TIMEOUT_MS)
      })
      await Promise.race([
        send(payload, { signal: controller.signal }),
        leaseLost,
        timedOut,
      ])
      if (heartbeatInFlight && !(await heartbeatInFlight)) {
        throw new Error("Outbox lease lost during SMTP send")
      }
      if (!(await heartbeat())) {
        throw new Error("Outbox lease lost before completion")
      }
    } finally {
      clearInterval(heartbeatTimer)
      if (timeout) clearTimeout(timeout)
    }
    const completedAt = deps.clock?.() ?? new Date()
    const completed = await completeOutboxEvent(
      db,
      claim.event.id,
      claim.leaseToken,
      completedAt
    )
    if (!completed) throw new Error("Outbox lease lost before completion")
    return "delivered"
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (claim.event.attempt_count >= MAX_ATTEMPTS) {
      await deadLetterOutboxEvent(
        db,
        claim.event.id,
        claim.leaseToken,
        message,
        now
      )
      return "dead-letter"
    }
    const delayMs = Math.min(
      60 * 60 * 1_000,
      5_000 * 2 ** Math.min(claim.event.attempt_count - 1, 8)
    )
    const released = await retryOutboxEvent(
      db,
      claim.event.id,
      claim.leaseToken,
      message,
      new Date(now.getTime() + delayMs),
      now
    )
    if (!released) {
      log.warn(
        { eventId: claim.event.id, error },
        "outbox retry fencing rejected"
      )
    }
    return "retry"
  }
}

export function startOutboxDispatcher(db: Db): void {
  if (timer) return
  const tick = () => {
    if (running) return
    running = true
    void (async () => {
      try {
        while ((await dispatchOutboxOnce(db)) !== "idle") {
          // Drain all currently available entries before sleeping.
        }
      } catch (error) {
        log.warn({ error }, "outbox dispatch cycle failed")
      } finally {
        running = false
      }
    })()
  }
  tick()
  timer = setInterval(tick, POLL_MS)
}

export function stopOutboxDispatcher(): void {
  if (timer) clearInterval(timer)
  timer = null
}
