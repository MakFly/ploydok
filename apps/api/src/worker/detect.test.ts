// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { detectBuildMethod } from "./detect"

describe("detectBuildMethod", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "ploydok-detect-test-"))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  // ---------------------------------------------------------------------------
  // Override mode
  // ---------------------------------------------------------------------------

  it("override=docker → returns docker without inspecting filesystem", async () => {
    const result = await detectBuildMethod({
      workspacePath: tmpDir,
      override: "docker",
    })
    expect(result.method).toBe("docker")
    expect(result.dockerfilePath).toBe("Dockerfile")
  })

  it("override=docker with custom dockerfilePath → returns that path", async () => {
    const result = await detectBuildMethod({
      workspacePath: tmpDir,
      override: "docker",
      dockerfilePath: "docker/Dockerfile.prod",
    })
    expect(result.method).toBe("docker")
    expect(result.dockerfilePath).toBe("docker/Dockerfile.prod")
  })

  it("override=nixpacks → returns nixpacks without inspecting filesystem", async () => {
    const result = await detectBuildMethod({
      workspacePath: tmpDir,
      override: "nixpacks",
    })
    expect(result.method).toBe("nixpacks")
    expect(result.dockerfilePath).toBeUndefined()
  })

  // ---------------------------------------------------------------------------
  // Auto-detection with Dockerfile present
  // ---------------------------------------------------------------------------

  it("auto-detect: Dockerfile at root → returns docker", async () => {
    await writeFile(path.join(tmpDir, "Dockerfile"), "FROM alpine\n")

    const result = await detectBuildMethod({ workspacePath: tmpDir })
    expect(result.method).toBe("docker")
    expect(result.dockerfilePath).toBe("Dockerfile")
  })

  it("auto-detect: Dockerfile in rootDir sub-path → returns docker", async () => {
    const subDir = path.join(tmpDir, "apps", "web")
    await mkdir(subDir, { recursive: true })
    await writeFile(path.join(subDir, "Dockerfile"), "FROM node:20\n")

    const result = await detectBuildMethod({
      workspacePath: tmpDir,
      rootDir: "apps/web",
    })
    expect(result.method).toBe("docker")
    expect(result.dockerfilePath).toBe("Dockerfile")
  })

  it("auto-detect: custom dockerfilePath → uses that name", async () => {
    await writeFile(path.join(tmpDir, "Dockerfile.prod"), "FROM alpine\n")

    const result = await detectBuildMethod({
      workspacePath: tmpDir,
      dockerfilePath: "Dockerfile.prod",
    })
    expect(result.method).toBe("docker")
    expect(result.dockerfilePath).toBe("Dockerfile.prod")
  })

  // ---------------------------------------------------------------------------
  // Auto-detection without Dockerfile
  // ---------------------------------------------------------------------------

  it("auto-detect: no Dockerfile → returns nixpacks", async () => {
    // tmpDir is empty — no Dockerfile
    const result = await detectBuildMethod({ workspacePath: tmpDir })
    expect(result.method).toBe("nixpacks")
    expect(result.dockerfilePath).toBeUndefined()
  })

  it("auto-detect: Dockerfile in wrong dir → returns nixpacks", async () => {
    // Dockerfile is at root but rootDir points to sub-dir without one
    await writeFile(path.join(tmpDir, "Dockerfile"), "FROM alpine\n")
    await mkdir(path.join(tmpDir, "api"), { recursive: true })

    const result = await detectBuildMethod({
      workspacePath: tmpDir,
      rootDir: "api",
    })
    expect(result.method).toBe("nixpacks")
  })

  // ---------------------------------------------------------------------------
  // override=auto falls through to auto-detect
  // ---------------------------------------------------------------------------

  it("override=auto behaves like no override (detects Dockerfile)", async () => {
    await writeFile(path.join(tmpDir, "Dockerfile"), "FROM alpine\n")

    const result = await detectBuildMethod({
      workspacePath: tmpDir,
      override: "auto",
    })
    expect(result.method).toBe("docker")
  })

  it("override=auto behaves like no override (falls back to nixpacks)", async () => {
    const result = await detectBuildMethod({
      workspacePath: tmpDir,
      override: "auto",
    })
    expect(result.method).toBe("nixpacks")
  })

  // ---------------------------------------------------------------------------
  // Railpack auto-detection
  // ---------------------------------------------------------------------------

  it("auto-detect: railpack.json at root → returns railpack", async () => {
    await writeFile(path.join(tmpDir, "railpack.json"), "{}\n")

    const result = await detectBuildMethod({ workspacePath: tmpDir })
    expect(result.method).toBe("railpack")
    expect(result.dockerfilePath).toBeUndefined()
  })

  it("auto-detect: Dockerfile + railpack.json → Dockerfile wins", async () => {
    await writeFile(path.join(tmpDir, "Dockerfile"), "FROM alpine\n")
    await writeFile(path.join(tmpDir, "railpack.json"), "{}\n")

    const result = await detectBuildMethod({ workspacePath: tmpDir })
    expect(result.method).toBe("docker")
    expect(result.dockerfilePath).toBe("Dockerfile")
  })

  it("override=railpack without config file → still respected", async () => {
    const result = await detectBuildMethod({
      workspacePath: tmpDir,
      override: "railpack",
    })
    expect(result.method).toBe("railpack")
  })

  it("auto-detect: custom railpackConfigPath honored", async () => {
    await writeFile(path.join(tmpDir, "railpack.custom.json"), "{}\n")

    const result = await detectBuildMethod({
      workspacePath: tmpDir,
      railpackConfigPath: "railpack.custom.json",
    })
    expect(result.method).toBe("railpack")
  })
})
