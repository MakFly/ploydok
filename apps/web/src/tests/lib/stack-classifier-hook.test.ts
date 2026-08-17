// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { ALL_PROBE_KEYS, MANIFEST_FILE_PROBE_KEYS } from "@ploydok/shared"
import { invalidateGetCache, resetCsrfToken } from "../../lib/api/client"
import {
  importEnvFileVars,
  runStackClassificationProbes,
} from "../../lib/stack-classifier-hook"

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
      if (url.includes("/env-file?")) {
        return new Response(
          JSON.stringify({ path: "apps/blog/.env", content: "API_URL=/api" }),
          { status: 200 }
        )
      }
      if (url.includes("/manifest-file?")) {
        return new Response(
          JSON.stringify({
            path: "composer.json",
            content: JSON.stringify({
              require: { "symfony/framework-bundle": "^7.0" },
            }),
          }),
          { status: 200 }
        )
      }
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

  it("uses one batch file-exists request and reads detected manifests", async () => {
    const result = await runStackClassificationProbes(
      "github",
      "dev-toolings/fixture-symfony-api",
      "main"
    )

    expect(calls).toHaveLength(2)
    expect(
      calls[0]?.path.startsWith(
        "/github/repos/dev-toolings/fixture-symfony-api/files-exist?"
      )
    ).toBe(true)

    const url = new URL(calls[0].path, "http://localhost")
    expect(url.searchParams.get("ref")).toBe("main")
    expect(url.searchParams.getAll("path")).toEqual(
      Array.from(new Set([...ALL_PROBE_KEYS, ...MANIFEST_FILE_PROBE_KEYS]))
    )
    expect(calls[1]?.path).toContain("/manifest-file?")
    expect(calls[1]?.path).toContain("path=composer.json")
    expect(result.probes).toEqual({
      "composer.json": true,
      "symfony.lock": true,
    })
    expect(result.classification.stack).toBe("symfony")
    expect(result.classification.recommendedBuild).toBe("nixpacks")
  })

  it("prefixes probes and manifests with rootDir", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString()
      calls.push({ path: url.replace(BASE, "") })
      if (url.includes("/env-file?")) {
        return new Response(
          JSON.stringify({ path: "apps/blog/.env", content: "API_URL=/api" }),
          { status: 200 }
        )
      }
      if (url.includes("/manifest-file?")) {
        const path = new URL(url, BASE).searchParams.get("path")
        return new Response(
          JSON.stringify({
            path,
            content:
              path === "apps/blog/package.json"
                ? JSON.stringify({ dependencies: { astro: "^5.0.0" } })
                : "export default defineConfig({})",
          }),
          { status: 200 }
        )
      }
      return new Response(
        JSON.stringify({
          files: {
            "apps/blog/package.json": true,
            "apps/blog/astro.config.mjs": true,
          },
        }),
        { status: 200 }
      )
    }) as typeof fetch

    const result = await runStackClassificationProbes(
      "github",
      "dev-toolings/monorepo",
      "main",
      "apps/blog"
    )

    const batchUrl = new URL(calls[0].path, "http://localhost")
    expect(batchUrl.searchParams.getAll("path")).toEqual(
      Array.from(
        new Set([...ALL_PROBE_KEYS, ...MANIFEST_FILE_PROBE_KEYS])
      ).map((path) => `apps/blog/${path}`)
    )
    expect(calls.some((call) => call.path.includes("path=apps%2Fblog%2Fpackage.json"))).toBe(true)
    expect(result.classification.stack).toBe("astro")
    expect(result.classification.recommendedBuild).toBe("static")

    const imported = await importEnvFileVars({
      source: "github",
      fullName: "dev-toolings/monorepo",
      ref: "main",
      path: ".env",
      rootDir: "apps/blog",
    })
    expect(imported).toEqual([{ key: "API_URL", value: "/api" }])
    expect(calls.at(-1)?.path).toContain("path=apps%2Fblog%2F.env")
  })

  it("treats rootDir dot as the repository root", async () => {
    await runStackClassificationProbes(
      "github",
      "dev-toolings/repository",
      "main",
      "."
    )

    const batchUrl = new URL(calls[0].path, "http://localhost")
    expect(batchUrl.searchParams.getAll("path")).toEqual(
      Array.from(new Set([...ALL_PROBE_KEYS, ...MANIFEST_FILE_PROBE_KEYS]))
    )
  })
})
