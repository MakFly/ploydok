// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test";

import { GitBranchSchema, GitRepoSchema } from "./git-providers";

describe("GitRepoSchema", () => {
  it("parses a valid GitHub API repo object", () => {
    const raw = {
      id: 123456789,
      fullName: "octocat/hello-world",
      description: "My first repository on GitHub!",
      private: false,
      defaultBranch: "main",
      cloneUrl: "https://github.com/octocat/hello-world.git",
    };

    const result = GitRepoSchema.parse(raw);

    expect(result.id).toBe(123456789);
    expect(result.fullName).toBe("octocat/hello-world");
    expect(result.description).toBe("My first repository on GitHub!");
    expect(result.private).toBe(false);
    expect(result.defaultBranch).toBe("main");
    expect(result.cloneUrl).toBe("https://github.com/octocat/hello-world.git");
  });

  it("parses a repo with string id (e.g. GitLab style)", () => {
    const raw = {
      id: "ns/project",
      fullName: "ns/project",
      description: null,
      private: true,
      defaultBranch: "master",
      cloneUrl: "https://gitlab.example.com/ns/project.git",
    };

    const result = GitRepoSchema.parse(raw);
    expect(result.id).toBe("ns/project");
    expect(result.description).toBeNull();
    expect(result.private).toBe(true);
  });

  it("rejects missing required fields", () => {
    expect(() =>
      GitRepoSchema.parse({
        id: 1,
        fullName: "owner/repo",
        // description missing => fails
        private: false,
        defaultBranch: "main",
        cloneUrl: "https://github.com/owner/repo.git",
      })
    ).toThrow();
  });

  it("rejects an invalid cloneUrl", () => {
    expect(() =>
      GitRepoSchema.parse({
        id: 1,
        fullName: "owner/repo",
        description: null,
        private: false,
        defaultBranch: "main",
        cloneUrl: "not-a-url",
      })
    ).toThrow();
  });
});

describe("GitBranchSchema", () => {
  it("parses a valid branch object", () => {
    const raw = { name: "feature/auth", commitSha: "abc123def456" };
    const result = GitBranchSchema.parse(raw);
    expect(result.name).toBe("feature/auth");
    expect(result.commitSha).toBe("abc123def456");
  });
});
