// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as React from "react"
import { Window } from "happy-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook } from "@testing-library/react"
import { toast } from "sonner"
import { invalidateGetCache, resetCsrfToken } from "../../lib/api"
import { useDeleteApp } from "../../lib/apps-mutations"
import type { AppListItem } from "../../lib/apps"

const BASE = "http://localhost:3335"
const toastMock = toast as unknown as {
  loading: () => string
  dismiss: () => void
  error: () => string
  success: () => string
}
let successCalls = 0
let loadingCalls = 0

function installDom(): void {
  const window = new Window()
  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    Node: window.Node,
    MutationObserver: window.MutationObserver,
    getComputedStyle: window.getComputedStyle.bind(window),
  })
}

describe("useDeleteApp", () => {
  beforeEach(() => {
    installDom()
    resetCsrfToken()
    invalidateGetCache()
    successCalls = 0
    loadingCalls = 0
    toastMock.loading = () => {
      loadingCalls += 1
      return "delete-app:app-1"
    }
    toastMock.dismiss = () => undefined
    toastMock.error = () => "delete-app:app-1"
    toastMock.success = () => {
      successCalls += 1
      return "delete-app:app-1"
    }
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url === `${BASE}/auth/csrf`) {
        return new Response(JSON.stringify({ token: "csrf-token" }), {
          status: 200,
        })
      }
      if (url === `${BASE}/apps/app-1`) {
        return new Response(
          JSON.stringify({ ok: true, jobId: "job-1", status: "queued" }),
          { status: 202 }
        )
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch
  })

  afterEach(() => {
    cleanup()
    invalidateGetCache()
    resetCsrfToken()
  })

  it("marks cached app lists as deleting until the delete SSE confirmation arrives", async () => {
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const apps: Array<AppListItem> = [
      {
        id: "app-1",
        name: "Demo",
        slug: "demo",
        status: "running",
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "app-2",
        name: "Other",
        slug: "other",
        status: "running",
        createdAt: 1,
        updatedAt: 1,
      },
    ]
    qc.setQueryData(["apps", "org-1"], apps)

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children)

    const { result } = renderHook(() => useDeleteApp("app-1"), { wrapper })

    await act(async () => {
      await result.current.mutateAsync()
    })

    expect(qc.getQueryData<Array<AppListItem>>(["apps", "org-1"])).toEqual([
      { ...apps[0], status: "deleting" },
      apps[1],
    ])
    expect(qc.getQueryData(["apps", "app-1"])).toBeUndefined()
    expect(loadingCalls).toBe(1)
    expect(successCalls).toBe(0)
  })
})
