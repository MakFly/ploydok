// SPDX-License-Identifier: AGPL-3.0-only
// Regression guard: authenticated users must be bounced away from public pages
// (/login, /register, /). The check lives on the _public layout, which wraps
// all public routes — without its beforeLoad, an authenticated user landing on
// /login would see the form again (UX/security bug).
import { describe, expect, it } from "bun:test"
import { Route as PublicLayout } from "../../routes/_public"
import { Route as AuthedLayout } from "../../routes/_authed"

describe("route layouts — auth guards", () => {
  it("_public layout exposes a beforeLoad handler (redirect if logged in)", () => {
    expect(typeof PublicLayout.options.beforeLoad).toBe("function")
  })

  it("_authed layout exposes a beforeLoad handler (require auth)", () => {
    expect(typeof AuthedLayout.options.beforeLoad).toBe("function")
  })
})
