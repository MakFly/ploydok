// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { ALL_PROBE_KEYS } from "@ploydok/shared"
import { invalidateGetCache, resetCsrfToken } from "../../lib/api/client"
import { runStackClassificationProbes } from "../../lib/stack-classifier-hook"

interface ApiCall {
  path: string
}

const BASE = "http://localhost:3335"
const calls: Array<ApiCall> = []
const originalFetch = globalThis.fetch
const originalWindow = globalThis.window

describe("runStackClassificationProbes", () => {
  beforeEach(() => {
    calls.length = 0
    resetCsrfToken()
    invalidateGetCache()
    ;(globalThis as { window?: unknown }).window = {}
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString()
      calls.push({ path: url.replace(BASE, "") })
      return new Response(
        JSON.stringify({
          files: {
            "composer.json": true,
            "symfony.lock": true,
          },
        }),
        { status: 200 }
      )
    }) as typeof fetch
  })

  afterEach(() => {
    invalidateGetCache()
    resetCsrfToken()
    globalThis.fetch = originalFetch
    ;(globalThis as { window?: unknown }).window = originalWindow
  })

  it("uses one batch file-exists request for the full probe set", async () => {
    const result = await runStackClassificationProbes(
      "github",
      "MakFly/fixture-symfony-api",
      "main"
    )

    expect(calls).toHaveLength(1)
    expect(
      calls[0]?.path.startsWith(
        "/github/repos/MakFly/fixture-symfony-api/files-exist?"
      )
    ).toBe(true)

    const url = new URL(calls[0].path, "http://localhost")
    expect(url.searchParams.get("ref")).toBe("main")
    expect(url.searchParams.getAll("path")).toEqual([...ALL_PROBE_KEYS])
    expect(result.probes).toEqual({
      "composer.json": true,
      "symfony.lock": true,
    })
    expect(result.classification.stack).toBe("symfony")
    expect(result.classification.recommendedBuild).toBe("nixpacks")
  })
})
