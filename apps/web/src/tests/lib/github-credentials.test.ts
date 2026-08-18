// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from "bun:test"
import * as React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { invalidateGetCache } from "../../lib/api"
import {
  useForgetLocalGitHubApp,
  useGitHubAppCredentialsStatus,
} from "../../lib/github"
import type {
  GitHubAppConfig,
  GitHubAppCredentialsStatus,
} from "../../lib/github"

const originalFetch = globalThis.fetch

afterEach(() => {
  cleanup()
  invalidateGetCache()
  globalThis.fetch = originalFetch
})

describe("useGitHubAppCredentialsStatus", () => {
  it("does not call the status endpoint until enabled", async () => {
    invalidateGetCache()
    const requests: Array<string> = []
    globalThis.fetch = ((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString()
      requests.push(url)
      return Promise.resolve(
        new Response(JSON.stringify({ status: "readable" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    }) as typeof fetch

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        children
      )

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useGitHubAppCredentialsStatus({ enabled }),
      { wrapper, initialProps: { enabled: false } }
    )

    expect(result.current.fetchStatus).toBe("idle")
    expect(requests).toHaveLength(0)

    act(() => rerender({ enabled: true }))
    await waitFor(() => expect(result.current.data?.status).toBe("readable"))
    expect(requests).toHaveLength(1)
    expect(requests[0]).toEndWith("/github/app/credentials/status")
  })

  it("forgets only the local App config and updates all GitHub caches", async () => {
    invalidateGetCache()
    const requests: Array<{ url: string; method: string }> = []
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString()
      const method = init?.method ?? "GET"
      requests.push({ url, method })
      if (url.endsWith("/auth/csrf")) {
        return Promise.resolve(
          new Response(JSON.stringify({ token: "csrf-token" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        )
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            forgotten: true,
            remoteInstallationsModified: false,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    }) as typeof fetch

    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    })
    queryClient.setQueryData<GitHubAppConfig>(["github", "app", "config"], {
      configured: true,
      name: "Ploydok",
    })
    const unreadableCredentials: GitHubAppCredentialsStatus = {
      status: "unreadable",
      error: {
        code: "GITHUB_APP_CREDENTIALS_UNREADABLE",
        message: "Unreadable",
      },
    }
    queryClient.setQueryData(
      ["github", "app", "credentials", "status"],
      unreadableCredentials
    )
    queryClient.setQueryData(["github", "installations"], {
      installations: [],
      installUrl: "",
    })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        children
      )
    const { result } = renderHook(() => useForgetLocalGitHubApp(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(requests.at(-1)?.url).toEndWith(
      "/github/app/config/local?confirm=forget-local-github-app"
    )
    expect(requests.at(-1)?.method).toBe("DELETE")
    expect(
      queryClient.getQueryData<GitHubAppConfig>(["github", "app", "config"])
    ).toEqual({ configured: false })
    expect(
      queryClient.getQueryData<GitHubAppCredentialsStatus>([
        "github",
        "app",
        "credentials",
        "status",
      ])
    ).toEqual({ status: "not_configured" })
    expect(
      queryClient.getQueryState(["github", "installations"])?.isInvalidated
    ).toBe(true)
  })
})
