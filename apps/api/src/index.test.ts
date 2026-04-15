// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test";
import { createApp } from "./index";

describe("createApp", () => {
  it("returns a Hono app instance", () => {
    const app = createApp();
    // Hono app exposes a fetch function
    expect(typeof app.fetch).toBe("function");
  });
});
