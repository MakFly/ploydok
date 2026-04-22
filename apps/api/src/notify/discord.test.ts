// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, mock } from "bun:test"
import { createDiscordAdapter } from "./discord"
import type { ChannelRow } from "./types"

const baseChannel: ChannelRow = {
  id: "ch1",
  owner_id: "user1",
  project_id: null,
  kind: "discord",
  name: "Test Discord",
  config: { kind: "discord", webhook_url: "https://discord.com/api/webhooks/test/token" },
  events: ["build.succeeded"],
  enabled: true,
  last_error: null,
  last_sent_at: null,
  created_at: new Date(),
}

describe("discordAdapter", () => {
  it("sends embed on success and returns ok=true", async () => {
    const fetchMock = mock(() => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("") }))
    const adapter = createDiscordAdapter(fetchMock as unknown as typeof fetch)

    const result = await adapter.send(baseChannel, "build.succeeded", {
      appId: "app1",
      appName: "My App",
      commitSha: "abc1234",
      durationMs: 5000,
    })

    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][]
    const [url, opts] = calls[0]!
    expect(url).toBe("https://discord.com/api/webhooks/test/token")
    const body = JSON.parse((opts as RequestInit).body as string)
    expect(body.embeds).toHaveLength(1)
    expect(body.embeds[0].title).toBe("build.succeeded")
    expect(body.embeds[0].color).toBeNumber()
  })

  it("returns ok=false when fetch throws", async () => {
    const fetchMock = mock(() => Promise.reject(new Error("network error")))
    const adapter = createDiscordAdapter(fetchMock as unknown as typeof fetch)

    const result = await adapter.send(baseChannel, "build.failed", {
      appId: "app1",
      appName: "My App",
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toContain("network error")
  })

  it("returns ok=false when HTTP 500", async () => {
    const fetchMock = mock(() => Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve("Internal Server Error") }))
    const adapter = createDiscordAdapter(fetchMock as unknown as typeof fetch)

    const result = await adapter.send(baseChannel, "deploy.failed", {
      appId: "app1",
      appName: "My App",
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toContain("500")
  })
})
