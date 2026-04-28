// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test"
import { classifyStack } from "@ploydok/shared"
import {
  generateLaravelAppKey,
  suggestedEnvForFramework,
} from "./framework-env"

describe("framework env guardrails", () => {
  it("generates Laravel-compatible APP_KEY values", () => {
    expect(generateLaravelAppKey()).toMatch(/^base64:[A-Za-z0-9+/]+=*$/)
  })

  it("adds APP_KEY to Laravel suggestions", () => {
    const classification = classifyStack({
      "composer.json": true,
      artisan: true,
    })

    const suggested = suggestedEnvForFramework(classification)

    expect(suggested.SESSION_DRIVER).toBe("file")
    expect(suggested.CACHE_STORE).toBe("file")
    expect(suggested.APP_KEY).toMatch(/^base64:[A-Za-z0-9+/]+=*$/)
  })

  it("does not add APP_KEY to non-Laravel suggestions", () => {
    const classification = classifyStack({ "package.json": true })

    const suggested = suggestedEnvForFramework(classification)

    expect(suggested.APP_KEY).toBeUndefined()
  })

  it("keeps Symfony runtime env explicit", () => {
    const classification = classifyStack({
      "composer.json": true,
      "symfony.lock": true,
    })

    const suggested = suggestedEnvForFramework(classification)

    expect(suggested.APP_ENV).toBe("prod")
    expect(suggested.APP_DEBUG).toBe("0")
  })
})
