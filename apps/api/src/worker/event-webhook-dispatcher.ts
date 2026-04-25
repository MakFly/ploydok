// SPDX-License-Identifier: AGPL-3.0-only
import type { Db } from "@ploydok/db"
import {
  listEnabledWebhooksForEvent,
  updateEventWebhook,
} from "@ploydok/db/queries"
import { decryptField } from "../github/app-credentials"
import type { WebhookPayload } from "@ploydok/shared"

const RETRY_DELAYS = [1000, 5000, 30000] // 1s, 5s, 30s in ms
const TIMEOUT_MS = 10000

async function computeHmacSignature(
  secret: string,
  body: string
): Promise<string> {
  const encoder = new TextEncoder()
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(body)
  )
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

interface DispatchEventOptions {
  orgId: string
  orgSlug: string
  event: string
  data: Record<string, unknown>
}

export async function dispatchEvent(
  db: Db,
  options: DispatchEventOptions
): Promise<void> {
  const { orgId, orgSlug, event, data } = options

  const webhooks = await listEnabledWebhooksForEvent(db, orgId, event)
  if (webhooks.length === 0) return

  const payload: WebhookPayload = {
    event: event as any,
    timestamp: new Date().toISOString(),
    org_id: orgId,
    org_slug: orgSlug,
    data,
  }

  const body = JSON.stringify(payload)

  for (const webhook of webhooks) {
    // Fire-and-forget with retries (no await)
    deliverWithRetry(
      db,
      webhook.id,
      webhook.org_id,
      webhook.url,
      webhook.secret_enc,
      webhook.secret_nonce,
      body,
      0
    ).catch(() => {
      // Silently handle errors to avoid crashing the event bus
    })
  }
}

async function deliverWithRetry(
  db: Db,
  webhookId: string,
  orgId: string,
  url: string,
  secretEnc: Buffer | null,
  secretNonce: Buffer | null,
  body: string,
  retryCount: number
): Promise<void> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Ploydok-Event": body ? JSON.parse(body).event : "unknown",
    }

    if (secretEnc && secretNonce) {
      try {
        const secret = await decryptField(secretEnc, secretNonce)
        const signature = await computeHmacSignature(secret, body)
        headers["X-Ploydok-Signature"] = `sha256=${signature}`
      } catch {
        // If decryption fails, continue without signature
      }
    }

    const controller = new AbortController()
    const timeoutHandle = setTimeout(() => controller.abort(), TIMEOUT_MS)

    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    })

    clearTimeout(timeoutHandle)

    const responseBody = await response.text().catch(() => "")

    await updateEventWebhook(db, webhookId, orgId, {
      last_triggered_at: new Date(),
      last_response_status: response.status,
      last_response_body: responseBody.substring(0, 2048),
      last_error: response.ok ? null : `HTTP ${response.status}`,
    })

    if (!response.ok && retryCount < RETRY_DELAYS.length) {
      const delay = RETRY_DELAYS[retryCount]!
      setTimeout(() => {
        deliverWithRetry(
          db,
          webhookId,
          orgId,
          url,
          secretEnc,
          secretNonce,
          body,
          retryCount + 1
        ).catch(() => {})
      }, delay)
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    await updateEventWebhook(db, webhookId, orgId, {
      last_triggered_at: new Date(),
      last_error: errorMessage.substring(0, 500),
    })

    if (retryCount < RETRY_DELAYS.length) {
      const delay = RETRY_DELAYS[retryCount]!
      setTimeout(() => {
        deliverWithRetry(
          db,
          webhookId,
          orgId,
          url,
          secretEnc,
          secretNonce,
          body,
          retryCount + 1
        ).catch(() => {})
      }, delay)
    }
  }
}
