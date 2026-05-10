// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test"
import { mapMembersResponse } from "../../lib/memberships"

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
