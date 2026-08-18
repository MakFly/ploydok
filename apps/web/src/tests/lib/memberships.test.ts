// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test"
import {
  clearInvitationTokenOnTerminalError,
  invitationLoginPath,
  isTerminalInvitationError,
  mapMembersResponse,
  validateInvitationPasswords,
} from "../../lib/memberships"
import { ApiError } from "../../lib/api"

describe("mapMembersResponse", () => {
  it("exposes pending invitations under the invitations key", () => {
    const invitedAt = new Date("2026-05-10T08:00:00.000Z")
    const expiresAt = new Date("2026-05-17T08:00:00.000Z")
    const acceptedAt = new Date("2026-05-10T09:00:00.000Z")

    const response = mapMembersResponse({
      members: [
        {
          user_id: "user-1",
          role: "owner",
          invited_at: invitedAt,
          accepted_at: acceptedAt,
          is_me: true,
          user: {
            email: "owner@example.com",
            display_name: "Owner",
          },
        },
      ],
      pending_invitations: [
        {
          id: "inv-1",
          org_id: "org-1",
          email: "invitee@example.com",
          role: "member",
          token_hash: "token-hash",
          expires_at: expiresAt,
          invited_by: "user-1",
          accepted_at: null,
          created_at: invitedAt,
        },
      ],
    })

    expect(response.invitations).toHaveLength(1)
    expect(response.invitations[0]?.email).toBe("invitee@example.com")
    expect(response.members[0]?.is_me).toBe(true)
  })
})

describe("invitation account flow", () => {
  it("keeps the bearer token out of the login redirect", () => {
    const token = "opaque+token/with=symbols"
    const loginUrl = new URL(invitationLoginPath(token), "https://ploydok.test")
    const redirect = loginUrl.searchParams.get("redirect")

    expect(redirect).toBe("/invitations/accept")
    expect(redirect).not.toContain(token)
  })

  it("blocks account submission when password confirmation differs", () => {
    expect(validateInvitationPasswords("password-123", "password-456")).toBe(
      "Passwords do not match"
    )
    expect(validateInvitationPasswords("password-123", "password-123")).toBe(
      null
    )
  })

  it("identifies invalid and expired invitation errors as terminal", () => {
    expect(
      isTerminalInvitationError(new ApiError(404, "NOT_FOUND", "gone"))
    ).toBe(true)
    expect(
      isTerminalInvitationError(new ApiError(410, "GONE", "expired"))
    ).toBe(true)
    expect(
      isTerminalInvitationError(new ApiError(503, "UNAVAILABLE", "retry"))
    ).toBe(false)
  })

  it("clears the stored bearer only for terminal invitation failures", () => {
    const removed: Array<string> = []
    const storage = { removeItem: (key: string) => removed.push(key) }
    expect(
      clearInvitationTokenOnTerminalError(
        storage,
        new ApiError(503, "UNAVAILABLE", "retry")
      )
    ).toBe(false)
    expect(removed).toEqual([])
    expect(
      clearInvitationTokenOnTerminalError(
        storage,
        new ApiError(410, "GONE", "expired")
      )
    ).toBe(true)
    expect(removed).toEqual(["ploydok.invitation-token"])
  })
})
