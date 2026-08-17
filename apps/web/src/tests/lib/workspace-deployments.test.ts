// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test"
import {
  normalizeWorkspaceDeploymentFilters,
  workspaceDeploymentsPath,
  workspaceDeploymentsQueryKey,
} from "../../lib/workspace-deployments"

describe("workspace deployment filters", () => {
  it("uses safe defaults for missing or invalid pagination", () => {
    expect(
      normalizeWorkspaceDeploymentFilters({ page: "zero", pageSize: 101 })
    ).toEqual({
      page: 1,
      pageSize: 100,
      appId: undefined,
      status: undefined,
      source: undefined,
      q: undefined,
      from: undefined,
      to: undefined,
    })
  })

  it("keeps supported filters and normalizes search text", () => {
    expect(
      normalizeWorkspaceDeploymentFilters({
        page: "2",
        pageSize: "50",
        appId: "app-1",
        status: "failed",
        source: "webhook:github",
        q: "  release  ",
        from: "2026-01-01",
        to: "2026-01-31",
      })
    ).toEqual({
      page: 2,
      pageSize: 50,
      appId: "app-1",
      status: "failed",
      source: "webhook:github",
      q: "release",
      from: "2026-01-01",
      to: "2026-01-31",
    })
  })

  it("drops unrecognized build status and invalid dates", () => {
    const filters = normalizeWorkspaceDeploymentFilters({
      status: "building",
      from: "not-a-date",
    })
    expect(filters.status).toBeUndefined()
    expect(filters.from).toBeUndefined()
  })

  it("keeps API filters bounded and normalizes a reversed date range", () => {
    const filters = normalizeWorkspaceDeploymentFilters({
      source: "not-a-source",
      q: "x".repeat(300),
      from: "2026-02-01",
      to: "2026-01-01",
    })
    expect(filters.source).toBeUndefined()
    expect(filters.q).toHaveLength(250)
    expect(filters.from).toBe("2026-01-01")
    expect(filters.to).toBe("2026-02-01")
  })
})

describe("workspace deployment request identity", () => {
  const filters = normalizeWorkspaceDeploymentFilters({
    page: 3,
    pageSize: 20,
    appId: "app-1",
    q: "release sha",
    from: "2026-01-01",
    to: "2026-01-31",
  })

  it("serializes all active filters into the API URL", () => {
    expect(workspaceDeploymentsPath("test local", filters)).toBe(
      "/organizations/test%20local/deployments?page=3&pageSize=20&appId=app-1&q=release+sha&from=2026-01-01T00%3A00%3A00.000Z&to=2026-01-31T23%3A59%3A59.999Z"
    )
  })

  it("keys cached pages by workspace and filters", () => {
    expect(workspaceDeploymentsQueryKey("test-local", filters)).toEqual([
      "organizations",
      "test-local",
      "deployments",
      filters,
    ])
  })
})
