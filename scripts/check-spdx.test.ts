// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test";
import { checkSpdx } from "./check-spdx";

describe("check-spdx", () => {
  it("runs on the current repo without violations", async () => {
    const { scanned, violations } = await checkSpdx();
    expect(scanned).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });
});
