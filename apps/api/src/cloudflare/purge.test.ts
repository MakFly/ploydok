// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from "bun:test"
import { purgeCloudflareForApp } from "./purge.js"

describe("purgeCloudflareForApp", () => {
  test("returns false when the DB lookup fails before any Cloudflare call", async () => {
    const db = {
      select() {
        return {
          from() {
            throw new Error("relation app_cloudflare_cdn does not exist")
          },
        }
      },
    }

    await expect(
      purgeCloudflareForApp(db as never, "app-1")
    ).resolves.toBeFalse()
  })
})
