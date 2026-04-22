// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, mock } from "bun:test"
import { createTelegramAdapter, buildTelegramMessage } from "./telegram"
import type { ChannelRow } from "./types"

const baseChannel: ChannelRow = {
  id: "ch1",
  owner_id: "user1",
  project_id: null,
  kind: "telegram",
  name: "Test Telegram",
  config: { kind: "telegram", bot_token: "123:abc", chat_id: "-1001234567890" },
  events: ["build.succeeded"],
  enabled: true,
  last_error: null,
  last_sent_at: null,
  created_at: new Date(),
}

function jsonResponse(ok: boolean, status: number, body: unknown) {
  return {
    ok,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  }
}

describe("telegramAdapter", () => {
  it("sends a sendMessage POST and returns ok=true", async () => {
    const fetchMock = mock(() => Promise.resolve(jsonResponse(true, 200, { ok: true, result: {} })))
    const adapter = createTelegramAdapter(fetchMock as unknown as typeof fetch)

    const result = await adapter.send(baseChannel, "build.succeeded", {
      appId: "app1",
      appName: "My App",
      commitSha: "abc12345",
      durationMs: 5000,
      appDomain: "example.com",
    })

    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][]
    const [url, opts] = calls[0]!
    expect(url).toBe("https://api.telegram.org/bot123:abc/sendMessage")
    const body = JSON.parse((opts as RequestInit).body as string)
    expect(body.chat_id).toBe("-1001234567890")
    expect(body.parse_mode).toBe("HTML")
    expect(body.disable_web_page_preview).toBe(true)
    expect(body.text).toContain("build.succeeded")
    expect(body.text).toContain("My App")
    expect(body.text).toContain("abc12345")
  })

  it("returns ok=false when fetch throws", async () => {
    const fetchMock = mock(() => Promise.reject(new Error("network error")))
    const adapter = createTelegramAdapter(fetchMock as unknown as typeof fetch)

    const result = await adapter.send(baseChannel, "build.failed", {
      appId: "app1",
      appName: "My App",
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toContain("network error")
  })

  it("returns ok=false on HTTP 400 from Telegram", async () => {
    const fetchMock = mock(() => Promise.resolve(jsonResponse(false, 400, { ok: false, description: "chat not found" })))
    const adapter = createTelegramAdapter(fetchMock as unknown as typeof fetch)

    const result = await adapter.send(baseChannel, "deploy.failed", {
      appId: "app1",
      appName: "My App",
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toContain("400")
  })

  it("returns ok=false when API responds with ok:false in 200 body", async () => {
    const fetchMock = mock(() => Promise.resolve(jsonResponse(true, 200, { ok: false, description: "bot was blocked" })))
    const adapter = createTelegramAdapter(fetchMock as unknown as typeof fetch)

    const result = await adapter.send(baseChannel, "build.succeeded", {
      appId: "app1",
      appName: "My App",
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toContain("bot was blocked")
  })

  it("returns invalid config on malformed channel.config", async () => {
    const fetchMock = mock(() => Promise.resolve(jsonResponse(true, 200, { ok: true })))
    const adapter = createTelegramAdapter(fetchMock as unknown as typeof fetch)
    const badChannel = {
      ...baseChannel,
      config: { kind: "telegram", bot_token: "", chat_id: "" },
    } as ChannelRow

    const result = await adapter.send(badChannel, "build.succeeded", {
      appId: "app1",
      appName: "My App",
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe("invalid telegram config")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("buildTelegramMessage — HTML escaping", () => {
  it("escapes < > & in app name + error", () => {
    const text = buildTelegramMessage("build.failed", {
      appId: "a",
      appName: "Foo <script>&",
      errorMessage: "boom <xml> & bad",
    })
    expect(text).toContain("Foo &lt;script&gt;&amp;")
    expect(text).toContain("boom &lt;xml&gt; &amp; bad")
  })

  it("includes the domain URL as an <a> link", () => {
    const text = buildTelegramMessage("deploy.succeeded", {
      appId: "a",
      appName: "x",
      appDomain: "foo.example.com",
    })
    expect(text).toContain('<a href="https://foo.example.com">foo.example.com</a>')
  })
})
