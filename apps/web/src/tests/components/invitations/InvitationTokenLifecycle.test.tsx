// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { cleanup, render, waitFor } from "@testing-library/react"
import { ApiError } from "../../../lib/api"
import { InvitationTokenLifecycle } from "../../../components/invitations/InvitationTokenLifecycle"

beforeEach(() => {
  window.history.replaceState(
    null,
    "",
    "/invitations/accept?token=secret"
  )
})

afterEach(() => {
  cleanup()
  window.sessionStorage.clear()
})

describe("InvitationTokenLifecycle", () => {
  it("stores the bearer and removes it from the browser URL on mount", async () => {
    render(<InvitationTokenLifecycle urlToken="secret" error={null} />)
    await waitFor(() => {
      expect(window.sessionStorage.getItem("ploydok.invitation-token")).toBe(
        "secret"
      )
      expect(window.location.search).toBe("")
    })
  })

  it("retains transient failures but clears terminal invalid invitations", async () => {
    window.sessionStorage.setItem("ploydok.invitation-token", "secret")
    const view = render(
      <InvitationTokenLifecycle
        urlToken=""
        error={new ApiError(503, "UNAVAILABLE", "retry")}
      />
    )
    await waitFor(() =>
      expect(window.sessionStorage.getItem("ploydok.invitation-token")).toBe(
        "secret"
      )
    )
    view.rerender(
      <InvitationTokenLifecycle
        urlToken=""
        error={new ApiError(410, "GONE", "expired")}
      />
    )
    await waitFor(() =>
      expect(
        window.sessionStorage.getItem("ploydok.invitation-token")
      ).toBeNull()
    )
  })
})
