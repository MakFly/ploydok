// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from "bun:test"
import {
  ADMIN_PASSWORD_MAX_BYTES,
  ADMIN_PASSWORD_MIN_CHARS,
  SetupAdminBodySchema,
  SetupAdminFormSchema,
} from "./auth"
import { fieldErrors } from "./validation"

const VALID = {
  email: "  Admin@Ploydok.LOCAL ",
  display_name: "  Kevin  ",
  password: "correct horse battery",
}

describe("SetupAdminBodySchema", () => {
  test("normalizes the email and trims the display name", () => {
    const parsed = SetupAdminBodySchema.parse(VALID)
    expect(parsed.email).toBe("admin@ploydok.local")
    expect(parsed.display_name).toBe("Kevin")
  })

  test("rejects a password shorter than the policy", () => {
    const parsed = SetupAdminBodySchema.safeParse({
      ...VALID,
      password: "a".repeat(ADMIN_PASSWORD_MIN_CHARS - 1),
    })
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(fieldErrors(parsed.error).password).toContain(
      `at least ${ADMIN_PASSWORD_MIN_CHARS}`
    )
  })

  // bcrypt tronque au-delà de 72 octets : la borne est en octets, pas en
  // caractères, sinon 30 emojis passeraient et seraient amputés au hash.
  test("counts the password limit in UTF-8 bytes", () => {
    const emoji = "😀".repeat(ADMIN_PASSWORD_MAX_BYTES / 4 + 1)
    expect(emoji.length).toBeLessThan(ADMIN_PASSWORD_MAX_BYTES)
    const parsed = SetupAdminBodySchema.safeParse({ ...VALID, password: emoji })
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(fieldErrors(parsed.error).password).toContain(
      `at most ${ADMIN_PASSWORD_MAX_BYTES} bytes`
    )
  })

  test("reports a missing email and display name on their own field", () => {
    const parsed = SetupAdminBodySchema.safeParse({
      email: "   ",
      display_name: "   ",
      password: VALID.password,
    })
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(fieldErrors(parsed.error)).toEqual({
      email: "Email is required",
      display_name: "Display name is required",
    })
  })

  test("rejects a malformed email with a readable message", () => {
    const parsed = SetupAdminBodySchema.safeParse({ ...VALID, email: "nope" })
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(fieldErrors(parsed.error).email).toBe("Enter a valid email address")
  })
})

describe("SetupAdminFormSchema", () => {
  test("blames the confirmation field when both passwords differ", () => {
    const parsed = SetupAdminFormSchema.safeParse({
      ...VALID,
      password_confirm: "something else entirely",
    })
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(fieldErrors(parsed.error)).toEqual({
      password_confirm: "Passwords do not match",
    })
  })

  test("accepts a matching pair and drops the setup token", () => {
    const parsed = SetupAdminFormSchema.parse({
      ...VALID,
      password_confirm: VALID.password,
    })
    expect(parsed).not.toHaveProperty("token")
    expect(parsed.password_confirm).toBe(VALID.password)
  })
})
