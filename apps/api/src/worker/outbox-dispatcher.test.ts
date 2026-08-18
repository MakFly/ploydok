// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, mock } from "bun:test"
import type { Db } from "@ploydok/db"

const completeMock = mock(
  async (_db: Db, _id: string, _token: string, _now: Date) => true
)
const retryMock = mock(
  async (
    _db: Db,
    _id: string,
    _token: string,
    _error: string,
    _availableAt: Date,
    _now: Date
  ) => true
)
const heartbeatMock = mock(
  async (_db: Db, _id: string, _token: string, _now: Date, _leaseMs: number) =>
    true
)
const deadLetterMock = mock(
  async (_db: Db, _id: string, _token: string, _error: string, _now: Date) =>
    true
)
const pendingInvitationMock = mock(
  async (): Promise<{ id: string } | null> => ({ id: "invitation-id" })
)
let claim: Record<string, unknown> | null
const claimNextMock = mock(async () => claim)

mock.module("@ploydok/db/queries", () => ({
  claimNextOutboxEvent: claimNextMock,
  completeOutboxEvent: completeMock,
  deadLetterOutboxEvent: deadLetterMock,
  getPendingInvitationById: pendingInvitationMock,
  heartbeatOutboxEvent: heartbeatMock,
  retryOutboxEvent: retryMock,
}))

const sendMock = mock(
  async (_input: unknown, _options?: { signal?: AbortSignal }) => undefined
)
const decryptMock = mock(async () =>
  JSON.stringify({
    kind: "mail",
    invitationId: "invitation-id",
    to: "member@example.com",
    subject: "Invitation",
    text: "Accept",
    messageId: "<invitation-id@ploydok.local>",
  })
)

const { dispatchOutboxOnce } = await import("./outbox-dispatcher")

beforeEach(() => {
  claim = {
    leaseToken: "lease-owner",
    event: {
      id: "invitation-email:id",
      invitation_id: "invitation-id",
      topic: "mail.invitation",
      payload_ciphertext: Buffer.from("ciphertext"),
      payload_nonce: Buffer.from("nonce"),
      attempt_count: 1,
    },
  }
  completeMock.mockClear()
  completeMock.mockResolvedValue(true)
  retryMock.mockClear()
  retryMock.mockResolvedValue(true)
  heartbeatMock.mockClear()
  heartbeatMock.mockResolvedValue(true)
  deadLetterMock.mockClear()
  deadLetterMock.mockResolvedValue(true)
  pendingInvitationMock.mockClear()
  pendingInvitationMock.mockResolvedValue({ id: "invitation-id" })
  sendMock.mockClear()
  sendMock.mockResolvedValue(undefined)
  claimNextMock.mockClear()
  claimNextMock.mockImplementation(async () => claim)
})

describe("transactional outbox dispatcher", () => {
  it("delivers once and completes only with the owning lease", async () => {
    const result = await dispatchOutboxOnce({} as Db, {
      decrypt: decryptMock,
      send: sendMock,
      now: new Date("2026-08-18T10:00:00.000Z"),
      leaseToken: "lease-owner",
      clock: () => new Date("2026-08-18T10:00:01.000Z"),
    })

    expect(result).toBe("delivered")
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "member@example.com",
        messageId: "<invitation-id@ploydok.local>",
      }),
      { signal: expect.any(AbortSignal) }
    )
    expect(completeMock).toHaveBeenCalledWith(
      {} as Db,
      "invitation-email:id",
      "lease-owner",
      new Date("2026-08-18T10:00:01.000Z")
    )
    expect(retryMock).not.toHaveBeenCalled()
    expect(heartbeatMock).toHaveBeenCalled()
  })

  it("does not send after the invitation is revoked", async () => {
    pendingInvitationMock.mockResolvedValueOnce(null)
    expect(
      await dispatchOutboxOnce({} as Db, {
        decrypt: decryptMock,
        send: sendMock,
        now: new Date("2026-08-18T10:00:00.000Z"),
      })
    ).toBe("dead-letter")
    expect(sendMock).not.toHaveBeenCalled()
    expect(deadLetterMock).toHaveBeenCalled()
  })

  it("checks and extends lease ownership immediately before SMTP", async () => {
    heartbeatMock.mockResolvedValueOnce(false)
    expect(
      await dispatchOutboxOnce({} as Db, {
        decrypt: decryptMock,
        send: sendMock,
        now: new Date("2026-08-18T10:00:00.000Z"),
      })
    ).toBe("retry")
    expect(sendMock).not.toHaveBeenCalled()
  })

  it("schedules a fenced retry when SMTP rejects the delivery", async () => {
    sendMock.mockRejectedValueOnce(new Error("SMTP unavailable"))
    const now = new Date("2026-08-18T10:00:00.000Z")

    expect(
      await dispatchOutboxOnce({} as Db, {
        decrypt: decryptMock,
        send: sendMock,
        now,
      })
    ).toBe("retry")
    expect(completeMock).not.toHaveBeenCalled()
    expect(retryMock).toHaveBeenCalledWith(
      {} as Db,
      "invitation-email:id",
      "lease-owner",
      "SMTP unavailable",
      new Date("2026-08-18T10:00:05.000Z"),
      now
    )
  })

  it("closes a slow SMTP delivery when its hard timeout fires", async () => {
    let aborted = false
    const slowSend = mock(
      async (_input: unknown, options?: { signal?: AbortSignal }) =>
        new Promise<void>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            aborted = true
            reject(options.signal?.reason)
          })
        })
    )

    expect(
      await dispatchOutboxOnce({} as Db, {
        decrypt: decryptMock,
        send: slowSend,
        smtpTimeoutMs: 5,
        heartbeatIntervalMs: 2,
      })
    ).toBe("retry")
    expect(aborted).toBe(true)
    expect(retryMock).toHaveBeenCalled()
  })

  it("aborts a stale dispatcher so only the successor can complete", async () => {
    const firstClaim = claim
    const secondClaim = {
      ...(claim as Record<string, unknown>),
      leaseToken: "lease-successor",
    }
    claimNextMock
      .mockResolvedValueOnce(firstClaim)
      .mockResolvedValueOnce(secondClaim)
    let firstHeartbeats = 0
    heartbeatMock.mockImplementation(async (_db, _id, token) => {
      if (token === "lease-successor") return true
      firstHeartbeats += 1
      return firstHeartbeats === 1
    })
    const firstSend = mock(
      async (_input: unknown, options?: { signal?: AbortSignal }) =>
        new Promise<void>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () =>
            reject(options.signal?.reason)
          )
        })
    )

    const stale = dispatchOutboxOnce({} as Db, {
      decrypt: decryptMock,
      send: firstSend,
      heartbeatIntervalMs: 2,
      smtpTimeoutMs: 100,
    })
    await new Promise((resolve) => setTimeout(resolve, 8))
    const successor = dispatchOutboxOnce({} as Db, {
      decrypt: decryptMock,
      send: sendMock,
      heartbeatIntervalMs: 2,
      smtpTimeoutMs: 100,
    })

    expect(await stale).toBe("retry")
    expect(await successor).toBe("delivered")
    expect(completeMock).toHaveBeenCalledTimes(1)
    expect(completeMock.mock.calls[0]?.[2]).toBe("lease-successor")
  })

  it("dead-letters and erases payload after the maximum attempt", async () => {
    ;(claim as { event: { attempt_count: number } }).event.attempt_count = 8
    sendMock.mockRejectedValueOnce(new Error("permanent SMTP failure"))
    expect(
      await dispatchOutboxOnce({} as Db, {
        decrypt: decryptMock,
        send: sendMock,
        now: new Date("2026-08-18T10:00:00.000Z"),
      })
    ).toBe("dead-letter")
    expect(deadLetterMock).toHaveBeenCalledWith(
      {} as Db,
      "invitation-email:id",
      "lease-owner",
      "permanent SMTP failure",
      new Date("2026-08-18T10:00:00.000Z")
    )
    expect(retryMock).not.toHaveBeenCalled()
  })

  it("stays idle when no durable event is claimable", async () => {
    claim = null
    expect(await dispatchOutboxOnce({} as Db)).toBe("idle")
    expect(sendMock).not.toHaveBeenCalled()
  })
})
