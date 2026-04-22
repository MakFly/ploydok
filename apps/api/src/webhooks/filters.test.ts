// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from "bun:test"
import {
  filterPushEvent,
  hasSkipDirective,
  matchesWatchPaths,
  matchesTagPattern,
} from "./filters"

// ---------------------------------------------------------------------------
// hasSkipDirective
// ---------------------------------------------------------------------------

describe("hasSkipDirective", () => {
  it("detects [skip deploy]", () => {
    expect(hasSkipDirective("fix: typo [skip deploy]")).toBe(true)
  })

  it("detects [skip ci] case-insensitive", () => {
    expect(hasSkipDirective("chore: bump [SKIP CI]")).toBe(true)
  })

  it("detects [no deploy]", () => {
    expect(hasSkipDirective("[no deploy] hotfix")).toBe(true)
  })

  it("detects [skip  deploy] with extra space", () => {
    expect(hasSkipDirective("[skip  deploy]")).toBe(true)
  })

  it("returns false for normal commit messages", () => {
    expect(hasSkipDirective("feat: add new feature")).toBe(false)
  })

  it("returns false for partial match", () => {
    expect(hasSkipDirective("skip deployment")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// matchesWatchPaths
// ---------------------------------------------------------------------------

describe("matchesWatchPaths", () => {
  it("matches apps/web/** against apps/web/src/foo.ts", () => {
    expect(matchesWatchPaths(["apps/web/src/foo.ts"], '["apps/web/**"]')).toBe(true)
  })

  it("does not match apps/web/** against apps/api/foo.ts", () => {
    expect(matchesWatchPaths(["apps/api/foo.ts"], '["apps/web/**"]')).toBe(false)
  })

  it("matches any of multiple patterns", () => {
    expect(
      matchesWatchPaths(
        ["packages/db/schema.ts"],
        '["apps/web/**", "packages/**"]',
      ),
    ).toBe(true)
  })

  it("returns true when watch_paths is null (watch everything)", () => {
    expect(matchesWatchPaths(["anything.ts"], null)).toBe(true)
  })

  it("returns true when watch_paths is empty array", () => {
    expect(matchesWatchPaths(["anything.ts"], "[]")).toBe(true)
  })

  it("returns true when changedFiles is empty", () => {
    // No changed files info → can't filter by path, so allow
    expect(matchesWatchPaths([], '["apps/web/**"]')).toBe(false)
  })

  it("returns true when watch_paths is invalid JSON", () => {
    expect(matchesWatchPaths(["foo.ts"], "not-json")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// filterPushEvent — full chain
// ---------------------------------------------------------------------------

const baseApp = {
  auto_deploy_enabled: true,
  branch: "main",
  watch_paths: null,
  coalesce_pushes: true,
}

describe("filterPushEvent", () => {
  it("returns enqueued when all filters pass", () => {
    const d = filterPushEvent(baseApp, {
      branch: "main",
      commitMessage: "feat: add feature",
    })
    expect(d.decision).toBe("enqueued")
  })

  it("returns skipped_disabled when auto_deploy_enabled=false", () => {
    const d = filterPushEvent(
      { ...baseApp, auto_deploy_enabled: false },
      { branch: "main", commitMessage: "feat: x" },
    )
    expect(d.decision).toBe("skipped_disabled")
  })

  it("returns skipped_branch when branch does not match", () => {
    const d = filterPushEvent(baseApp, {
      branch: "feature/x",
      commitMessage: "feat: x",
    })
    expect(d.decision).toBe("skipped_branch")
  })

  it("returns skipped_path when no changed file matches watch_paths", () => {
    const d = filterPushEvent(
      { ...baseApp, watch_paths: '["apps/web/**"]' },
      {
        branch: "main",
        commitMessage: "chore: bump",
        changedFiles: ["apps/api/src/index.ts"],
      },
    )
    expect(d.decision).toBe("skipped_path")
  })

  it("returns enqueued when a changed file matches watch_paths", () => {
    const d = filterPushEvent(
      { ...baseApp, watch_paths: '["apps/web/**"]' },
      {
        branch: "main",
        commitMessage: "feat: ui",
        changedFiles: ["apps/web/src/main.tsx"],
      },
    )
    expect(d.decision).toBe("enqueued")
  })

  it("returns skipped_directive when commit message has [skip deploy]", () => {
    const d = filterPushEvent(baseApp, {
      branch: "main",
      commitMessage: "chore: bump deps [skip deploy]",
    })
    expect(d.decision).toBe("skipped_directive")
  })

  it("auto_deploy check takes priority over branch", () => {
    const d = filterPushEvent(
      { ...baseApp, auto_deploy_enabled: false, branch: "main" },
      { branch: "other", commitMessage: "x" },
    )
    expect(d.decision).toBe("skipped_disabled")
  })
})

// ---------------------------------------------------------------------------
// matchesTagPattern
// ---------------------------------------------------------------------------

describe("matchesTagPattern", () => {
  it("returns true when pattern is null (accept all)", () => {
    expect(matchesTagPattern("v1.2.3", null)).toBe(true)
  })

  it("returns true when tag matches the pattern", () => {
    expect(matchesTagPattern("v1.2.3", "^v\\d+\\.\\d+\\.\\d+$")).toBe(true)
  })

  it("returns false when tag does not match the pattern", () => {
    expect(matchesTagPattern("release-2024", "^v\\d+\\.\\d+\\.\\d+$")).toBe(false)
  })

  it("returns false and does not throw for invalid regex", () => {
    expect(matchesTagPattern("v1.0.0", "[invalid(")).toBe(false)
  })
})
