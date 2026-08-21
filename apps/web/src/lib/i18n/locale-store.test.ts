// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, test } from "bun:test"
import { LOCALE_COOKIE } from "./locales"
import { changeLocale } from "./locale-store"
import i18n from "./index"

describe("changeLocale", () => {
  afterEach(async () => {
    document.cookie = `${LOCALE_COOKIE}=; Path=/; Max-Age=0`
    document.documentElement.removeAttribute("lang")
    await i18n.changeLanguage("en")
  })

  test("writes the locale cookie and sets documentElement.lang", async () => {
    changeLocale("fr")
    await i18n.changeLanguage("fr")
    expect(document.cookie).toContain(`${LOCALE_COOKIE}=fr`)
    expect(document.documentElement.lang).toBe("fr")
    expect(i18n.language).toBe("fr")
  })
})
