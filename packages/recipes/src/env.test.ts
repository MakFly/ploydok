// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test";
import { isProductionAppEnv } from "./env";

describe("isProductionAppEnv", () => {
  it.each(["prod", "production", "live", "PROD", " Production "])(
    "%p → true",
    (v) => {
      expect(isProductionAppEnv(v)).toBe(true);
    },
  );

  it.each([
    "dev",
    "development",
    "local",
    "staging",
    "preprod",
    "pre-prod",
    "preproduction",
    "preview",
    "test",
    "testing",
    "qa",
    "review-123",
  ])("%p → false (non-production)", (v) => {
    expect(isProductionAppEnv(v)).toBe(false);
  });

  it("empty / undefined / null → true (safe default)", () => {
    expect(isProductionAppEnv(undefined)).toBe(true);
    expect(isProductionAppEnv(null)).toBe(true);
    expect(isProductionAppEnv("")).toBe(true);
    expect(isProductionAppEnv("   ")).toBe(true);
  });
});
