// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test"
import {
  TransientDeployError,
  FatalDeployError,
  classifyAgentError,
} from "./errors"

describe("classifyAgentError", () => {
  // ── Transient ──────────────────────────────────────────────────────────────

  it("classifies ECONNREFUSED as transient", () => {
    const err = new Error("connect ECONNREFUSED 127.0.0.1:2375")
    expect(classifyAgentError(err)).toBeInstanceOf(TransientDeployError)
  })

  it("classifies ETIMEDOUT as transient", () => {
    const err = new Error("connect ETIMEDOUT")
    expect(classifyAgentError(err)).toBeInstanceOf(TransientDeployError)
  })

  it("classifies ECONNRESET as transient", () => {
    const err = new Error("read ECONNRESET")
    expect(classifyAgentError(err)).toBeInstanceOf(TransientDeployError)
  })

  it("classifies gRPC UNAVAILABLE as transient", () => {
    const err = new Error("14 UNAVAILABLE: No connection established")
    expect(classifyAgentError(err)).toBeInstanceOf(TransientDeployError)
  })

  it("classifies gRPC DEADLINE_EXCEEDED as transient", () => {
    const err = new Error("4 DEADLINE_EXCEEDED: Deadline exceeded")
    expect(classifyAgentError(err)).toBeInstanceOf(TransientDeployError)
  })

  it("classifies Redis timeout as transient", () => {
    const err = new Error("redis connection timeout")
    expect(classifyAgentError(err)).toBeInstanceOf(TransientDeployError)
  })

  it("classifies Docker registry 500 as transient", () => {
    const err = new Error("docker registry responded with 500")
    expect(classifyAgentError(err)).toBeInstanceOf(TransientDeployError)
  })

  it("classifies socket hang up as transient", () => {
    const err = new Error("socket hang up")
    expect(classifyAgentError(err)).toBeInstanceOf(TransientDeployError)
  })

  // ── Fatal ──────────────────────────────────────────────────────────────────

  it("classifies Dockerfile parse error as fatal", () => {
    const err = new Error("dockerfile parse error: invalid syntax at line 3")
    expect(classifyAgentError(err)).toBeInstanceOf(FatalDeployError)
  })

  it("classifies nixpacks failed as fatal", () => {
    const err = new Error("nixpacks failed: cannot detect runtime")
    expect(classifyAgentError(err)).toBeInstanceOf(FatalDeployError)
  })

  it("classifies image manifest not found as fatal", () => {
    const err = new Error("manifest unknown: manifest unknown")
    expect(classifyAgentError(err)).toBeInstanceOf(FatalDeployError)
  })

  it("classifies image not found as fatal", () => {
    const err = new Error("image not found: nginx:999")
    expect(classifyAgentError(err)).toBeInstanceOf(FatalDeployError)
  })

  it("classifies registry 401 unauthorized as fatal", () => {
    const err = new Error("unauthorized registry: authentication required")
    expect(classifyAgentError(err)).toBeInstanceOf(FatalDeployError)
  })

  it("classifies registry denied (403) as fatal", () => {
    const err = new Error("denied registry: access denied")
    expect(classifyAgentError(err)).toBeInstanceOf(FatalDeployError)
  })

  it("classifies no such image as fatal", () => {
    const err = new Error("no such image: alpine:does-not-exist")
    expect(classifyAgentError(err)).toBeInstanceOf(FatalDeployError)
  })

  it("classifies app not found as fatal", () => {
    const err = new Error("App not found: abc123")
    expect(classifyAgentError(err)).toBeInstanceOf(FatalDeployError)
  })

  it("classifies missing repo_full_name as fatal", () => {
    const err = new Error("App abc has no repo_full_name — missing repo_full_name")
    expect(classifyAgentError(err)).toBeInstanceOf(FatalDeployError)
  })

  it("classifies image_ref missing as fatal", () => {
    const err = new Error("App abc has git_provider='image' but no image_ref set")
    expect(classifyAgentError(err)).toBeInstanceOf(FatalDeployError)
  })

  // ── Default (unknown) ──────────────────────────────────────────────────────

  it("defaults unknown errors to transient", () => {
    const err = new Error("some completely unknown failure")
    expect(classifyAgentError(err)).toBeInstanceOf(TransientDeployError)
  })

  it("handles non-Error values", () => {
    const result = classifyAgentError("string error")
    expect(result).toBeInstanceOf(TransientDeployError)
  })

  // ── Cause preservation ─────────────────────────────────────────────────────

  it("preserves original error as cause", () => {
    const original = new Error("ECONNREFUSED")
    const classified = classifyAgentError(original)
    expect(classified.cause).toBe(original)
  })

  it("preserves message from original error", () => {
    const original = new Error("connect ECONNREFUSED 127.0.0.1:2375")
    const classified = classifyAgentError(original)
    expect(classified.message).toBe(original.message)
  })
})
