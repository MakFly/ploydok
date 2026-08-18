// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from "bun:test"
import { cleanup, fireEvent, render } from "@testing-library/react"
import { RepoItem } from "../../../components/apps/GitLabRepoSelector"
import type { GitRepo } from "@ploydok/shared"

afterEach(cleanup)

describe("GitLab project option", () => {
  const repo: GitRepo = {
    id: 431,
    fullName: "platform/services/api",
    defaultBranch: "develop",
    private: true,
    description: "Nested GitLab project",
    cloneUrl: "https://gitlab.example.test/platform/services/api.git",
  }

  it("exposes nested namespaces and supports keyboard selection", () => {
    let selected: GitRepo | null = null
    const view = render(
      <ul role="listbox">
        <RepoItem
          repo={repo}
          isSelected={false}
          onSelect={(value) => {
            selected = value
          }}
        />
      </ul>
    )

    const option = view.getByRole("option", { name: /api platform\/services/i })
    expect(option.getAttribute("aria-selected")).toBe("false")
    fireEvent.keyDown(option, { key: "Enter" })
    expect(selected as GitRepo | null).toEqual(repo)
  })
})
