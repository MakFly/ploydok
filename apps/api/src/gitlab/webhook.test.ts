// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test";
import { verifyGitLabToken } from "./webhook";

describe("verifyGitLabToken", () => {
  it("accepts a byte-for-byte matching token", () => {
    expect(verifyGitLabToken("secret-123", "secret-123")).toBe(true);
  });

  it("rejects mismatches", () => {
    expect(verifyGitLabToken("secret-123", "SECRET-123")).toBe(false);
    expect(verifyGitLabToken("secret-123", "secret-122")).toBe(false);
  });

  it("rejects missing inputs", () => {
    expect(verifyGitLabToken(null, "secret-123")).toBe(false);
    expect(verifyGitLabToken("", "secret-123")).toBe(false);
    expect(verifyGitLabToken("secret-123", "")).toBe(false);
  });

  it("rejects tokens of different length (without leaking timing)", () => {
    expect(verifyGitLabToken("short", "longer-secret")).toBe(false);
  });
});
