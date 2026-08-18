// SPDX-License-Identifier: AGPL-3.0-only
import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "bun:test"
import { SessionHistoryPopover } from "../../../components/settings/SessionHistoryPopover"

afterEach(cleanup)

const session = {
  id: "session-current",
  user_agent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36",
  ip: "127.0.0.1",
  created_at: "2026-08-18T08:00:00.000Z",
  last_seen_at: "2026-08-18T08:15:00.000Z",
  expires_at: "2026-08-25T08:00:00.000Z",
  is_current: true,
} as const

describe("SessionHistoryPopover", () => {
  it("opens and closes the session timeline", () => {
    const view = render(<SessionHistoryPopover sessions={[session]} />)
    const trigger = view.getByRole("button", { name: "Open session history" })

    expect(trigger.getAttribute("aria-expanded")).toBe("false")

    fireEvent.click(trigger)

    expect(trigger.getAttribute("aria-expanded")).toBe("true")

    fireEvent.click(trigger)

    expect(trigger.getAttribute("aria-expanded")).toBe("false")
  })
})
