// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { fieldErrors, firstErrorMessage } from "./validation"

function errorOf(schema: z.ZodType, value: unknown): z.ZodError {
  const parsed = schema.safeParse(value)
  if (parsed.success) throw new Error("expected the schema to reject")
  return parsed.error
}

const schema = z.object({
  email: z.string().email("Enter a valid email address"),
  name: z.string().min(1, "Name is required"),
})

describe("fieldErrors", () => {
  test("indexes the first issue of each field by path", () => {
    expect(fieldErrors(errorOf(schema, { email: "nope", name: "" }))).toEqual({
      email: "Enter a valid email address",
      name: "Name is required",
    })
  })

  test("keeps the first issue when a field has several", () => {
    const multi = z.object({
      password: z.string().min(12, "too short").regex(/\d/, "needs a digit"),
    })
    expect(fieldErrors(errorOf(multi, { password: "abc" })).password).toBe(
      "too short"
    )
  })

  test("groups a pathless object-level issue under '_'", () => {
    const crossField = z
      .object({ a: z.string(), b: z.string() })
      .refine((v) => v.a === v.b, "values must match")
    expect(fieldErrors(errorOf(crossField, { a: "x", b: "y" }))).toEqual({
      _: "values must match",
    })
  })

  test("joins nested paths with a dot", () => {
    const nested = z.object({
      user: z.object({ email: z.string().email("bad") }),
    })
    // Clé littérale : `toHaveProperty` lirait le point comme un chemin.
    const errors = fieldErrors(errorOf(nested, { user: { email: "nope" } }))
    expect(errors["user.email"]).toBe("bad")
  })
})

describe("firstErrorMessage", () => {
  test("returns the first issue message rather than Zod's JSON dump", () => {
    const message = firstErrorMessage(errorOf(schema, { email: "x", name: "" }))
    expect(message).toBe("Enter a valid email address")
    expect(message).not.toContain("[")
  })
})
