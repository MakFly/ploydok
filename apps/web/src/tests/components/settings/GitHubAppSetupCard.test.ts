// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from "bun:test"
import * as React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render } from "@testing-library/react"
import { GitHubAppSetupCard } from "../../../components/settings/providers/GitHubAppSetupCard"

describe("GitHubAppSetupCard recovery mode", () => {
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
    expect(view.queryByText("How to reconnect the GitHub App")).toBeNull()
    fireEvent.click(view.getByRole("button", { name: "How to reconnect" }))
    expect(view.getByText("How to reconnect the GitHub App")).toBeTruthy()
    expect(
      view.getByText("http://localhost:3335/github/app/callback")
    ).toBeTruthy()
    expect(
      view.getByText("http://localhost:3335/github/app/setup")
    ).toBeTruthy()
    expect(view.getByText("http://localhost:3335/github/webhook")).toBeTruthy()
    expect(
      view.getByRole("link", { name: "Open personal App settings ↗" })
    ).toBeTruthy()
  })
})
