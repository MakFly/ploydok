// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, mock } from "bun:test"
import type { Transporter } from "nodemailer"
import { sendMailWithTransport } from "./mailer"

describe("abortable SMTP transport", () => {
  it("closes the dedicated transport and rejects an in-flight delivery", async () => {
    const close = mock(() => undefined)
    let delivered = false
    let rejectDelivery: ((error: Error) => void) | undefined
    let deliveryTimer: ReturnType<typeof setTimeout> | undefined
    const abortActive = mock(() => {
      if (deliveryTimer) clearTimeout(deliveryTimer)
      rejectDelivery?.(new Error("SMTP socket closed"))
    })
    const sendMail = mock(
      async () =>
        new Promise<never>((_resolve, reject) => {
          rejectDelivery = reject
          deliveryTimer = setTimeout(() => {
            delivered = true
          }, 20)
        })
    ) as unknown as Transporter["sendMail"]
    const controller = new AbortController()
    const delivery = sendMailWithTransport(
      { sendMail, close, abortActive },
      { to: "member@example.com", subject: "Invite", text: "Accept" },
      { signal: controller.signal }
    )

    controller.abort(new Error("lease lost"))

    await expect(delivery).rejects.toThrow("lease lost")
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(abortActive).toHaveBeenCalledTimes(1)
    expect(delivered).toBe(false)
    expect(close).toHaveBeenCalledTimes(1)
  })
})
