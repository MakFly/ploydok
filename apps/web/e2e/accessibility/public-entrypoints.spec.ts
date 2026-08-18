// SPDX-License-Identifier: AGPL-3.0-only
import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"

const ENABLED = process.env["PLOYDOK_A11Y_E2E"] === "1"

async function expectNoSeriousViolations(
  page: Page
): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze()
  const blocking = result.violations.filter((violation) =>
    ["critical", "serious"].includes(violation.impact ?? "")
  )
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([])
}

test.describe("critical public accessibility", () => {
  test.skip(!ENABLED, "requires a protected PLOYDOK_A11Y_E2E fixture")

  test("login is keyboard reachable and has no serious violations", async ({
    page,
  }) => {
    await page.goto("/login")
    await expect(page.getByRole("main")).toBeVisible()
    await page.keyboard.press("Tab")
    await expect(page.locator(":focus")).toBeVisible()
    await expectNoSeriousViolations(page)
  })

  test("fresh setup has no serious violations", async ({ page }) => {
    const freshBase = process.env["E2E_FRESH_WEB_URL"]
    test.skip(!freshBase, "requires E2E_FRESH_WEB_URL for an unbootstrapped fixture")
    await page.goto(`${freshBase}/setup`)
    await expect(page).toHaveURL(/\/setup(?:\?|$)/)
    await expect(page.getByRole("main")).toBeVisible()
    await expectNoSeriousViolations(page)
  })
})
