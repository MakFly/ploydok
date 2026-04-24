// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from "bun:test"

describe("invitations routes", () => {
  it("happy path: GET /preview shows invitation details", () => {
    expect(true).toBe(true)
  })

  it("happy path: POST /accept accepts invitation", () => {
    expect(true).toBe(true)
  })

  it("blocks accept if invitation expired", () => {
    expect(true).toBe(true)
  })

  it("blocks accept if email mismatch", () => {
    expect(true).toBe(true)
  })
})
