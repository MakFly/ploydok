// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, mock } from "bun:test"
import { ALL_PROBE_KEYS } from "@ploydok/shared"

interface ApiCall {
  path: string
}

const calls: ApiCall[] = []

mock.module("../../lib/api", () => ({
  apiFetch: async (path: string) => {
    calls.push({ path })
    return {
      files: {
        "composer.json": true,
        "symfony.lock": true,
      },
    }
  },
}))

const { runStackClassificationProbes } = await import(
  "../../lib/stack-classifier-hook"
)

describe("runStackClassificationProbes", () => {
  beforeEach(() => {
    calls.length = 0
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

    const url = new URL(calls[0]!.path, "http://localhost")
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
