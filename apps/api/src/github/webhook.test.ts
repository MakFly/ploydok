// SPDX-License-Identifier: AGPL-3.0-only
import { createHmac } from "node:crypto";
import { describe, expect, it } from "bun:test";
import { verifySignature } from "./webhook";

// ---------------------------------------------------------------------------
// verifySignature
// ---------------------------------------------------------------------------

describe("verifySignature", () => {
  const secret = "test-webhook-secret";
  const body = JSON.stringify({ ref: "refs/heads/main", after: "abc123" });

  function makeSignature(b: string, s: string): string {
    return "sha256=" + createHmac("sha256", s).update(b).digest("hex");
  }

  it("returns true for a valid signature", () => {
    const sig = makeSignature(body, secret);
    expect(verifySignature(body, sig, secret)).toBe(true);
  });

  it("returns false for a null signature", () => {
    expect(verifySignature(body, null, secret)).toBe(false);
  });

  it("returns false for a signature without sha256= prefix", () => {
    const raw = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifySignature(body, raw, secret)).toBe(false);
  });

  it("returns false for a tampered body", () => {
    const sig = makeSignature(body, secret);
    expect(verifySignature(body + "x", sig, secret)).toBe(false);
  });

  it("returns false for a wrong secret", () => {
    const sig = makeSignature(body, "wrong-secret");
    expect(verifySignature(body, sig, secret)).toBe(false);
  });

  it("returns false for a signature of different length", () => {
    // Truncated signature — should fail length check before timingSafeEqual
    expect(verifySignature(body, "sha256=abc", secret)).toBe(false);
  });
});
