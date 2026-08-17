// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render } from "@testing-library/react"
import { Window } from "happy-dom"
import { GitHubAppSetupCard } from "../../../components/settings/providers/GitHubAppSetupCard"

function installDom(): void {
  const window = new Window()
  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    MutationObserver: window.MutationObserver,
    getComputedStyle: window.getComputedStyle.bind(window),
  })
}

describe("GitHubAppSetupCard recovery mode", () => {
  beforeEach(installDom)
  afterEach(cleanup)

  it("opens the import form and hides App creation", () => {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    })
    const view = render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(GitHubAppSetupCard, {
          mode: "reconnect",
          isPending: false,
          onCreate: () => undefined,
          onImported: () => undefined,
          error: null,
        })
      )
    )

    expect(view.getByText("Reconnect the GitHub App")).toBeTruthy()
    expect(view.getByLabelText("App ID")).toBeTruthy()
    expect(view.getByRole("button", { name: "Save existing App" })).toBeTruthy()
    expect(view.queryByRole("button", { name: "Create GitHub App" })).toBeNull()
  })
})
