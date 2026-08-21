// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test"
import { getGitLabSourceAvailability } from "../../lib/git-providers"
import { gitLabOAuthErrorMessage } from "../../lib/gitlab"
import {
  buildCreateAppBody,
  initialForm,
  repoDerivedDefaults,
} from "../../components/apps/CreateAppModal"
import type { GitProviderStatus } from "../../lib/git-providers"

function status(configured: boolean, connected: boolean): GitProviderStatus {
  return {
    ready: connected,
    github: { configured: false, connected: false },
    gitlab: { configured, connected },
  }
}

describe("GitLab create flow", () => {
  it("enables GitLab only after instance setup and user connection", () => {
    expect(
      getGitLabSourceAvailability(undefined, { loading: true }).enabled
    ).toBe(false)
    expect(getGitLabSourceAvailability(status(false, false))).toMatchObject({
      enabled: false,
    })
    expect(getGitLabSourceAvailability(status(true, false))).toMatchObject({
      enabled: false,
    })
    expect(getGitLabSourceAvailability(status(true, true))).toEqual({
      enabled: true,
      reason: null,
    })
    const outage = status(true, false)
    outage.gitlab.state = "unavailable"
    expect(getGitLabSourceAvailability(outage).reason).toContain(
      "temporarily unavailable"
    )
  })

  it("maps bounded OAuth errors and hides absent results", () => {
    expect(gitLabOAuthErrorMessage("?gitlab_error=access_denied")).toContain(
      "denied"
    )
    expect(
      gitLabOAuthErrorMessage("?gitlab_error=unknown-provider-detail")
    ).toContain("authorize")
    expect(gitLabOAuthErrorMessage("?connected=1")).toBeNull()
  })

  it("builds the GitLab payload and clears repository-derived configuration", () => {
    const form = initialForm("gitlab")
    form.name = "Nested API"
    form.selectedRepo = {
      id: 431,
      fullName: "platform/services/api",
      description: null,
      private: true,
      defaultBranch: "develop",
      cloneUrl: "https://gitlab.example.test/platform/services/api.git",
    }
    form.branch = "develop"
    form.initialEnvVars = [
      { id: "secret", key: "API_KEY", value: "stale", phase: "runtime" },
    ]
    form.watchPaths = "old/**"

    expect(buildCreateAppBody(form)).toMatchObject({
      name: "Nested API",
      gitProvider: "gitlab",
      gitlabProjectId: 431,
      repoFullName: "platform/services/api",
      branch: "develop",
    })
    expect(repoDerivedDefaults()).toMatchObject({
      initialEnvVars: [],
      watchPaths: "",
      rootDir: "",
      buildMethod: "auto",
      buildMethodTouched: false,
    })
  })
})
