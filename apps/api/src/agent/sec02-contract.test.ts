// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test"
import { readFile } from "node:fs/promises"

const repoRoot = new URL("../../../../", import.meta.url)

describe("SEC-02 agent contract", () => {
  it("exposes every privileged image and GC operation through gRPC", async () => {
    const proto = await readFile(
      new URL("packages/agent-proto/proto/agent.proto", repoRoot),
      "utf8"
    )

    for (const rpc of [
      "ImagePush",
      "ImageRemove",
      "BuildCachePrune",
      "RegistryGarbageCollect",
    ]) {
      expect(proto).toContain(`rpc ${rpc}`)
    }
  })

  it("keeps the production API image free of Docker CLI/buildx", async () => {
    const dockerfile = await readFile(
      new URL("apps/api/Dockerfile", repoRoot),
      "utf8"
    )
    expect(dockerfile).not.toContain("FROM docker:")
    expect(dockerfile).not.toContain("docker-buildx")
    expect(dockerfile).not.toContain("/usr/local/bin/docker")
    expect(dockerfile).toContain("USER bun")
  })

  it("runs the production web image as a non-root user", async () => {
    const dockerfile = await readFile(
      new URL("apps/web/Dockerfile", repoRoot),
      "utf8"
    )
    expect(dockerfile).toContain("USER bun")
  })
})
