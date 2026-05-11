// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test"
import { generateAuthOptions } from "./webauthn"

describe("generateAuthOptions", () => {
  it("preserves required user verification for passkey login", async () => {
    const options = await generateAuthOptions({ userVerification: "required" })

    expect(options.userVerification).toBe("required")
  })
})
