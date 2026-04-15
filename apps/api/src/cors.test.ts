// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test";
import { app } from "./app";
import { env } from "./env";

describe("CORS", () => {
  it("preflight with correct Origin returns 204 + ACAO header", async () => {
    const res = await app.request("/health", {
      method: "OPTIONS",
      headers: {
        Origin: env.WEB_ORIGIN,
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(env.WEB_ORIGIN);
  });

  it("preflight with incorrect Origin does not echo ACAO header", async () => {
    const res = await app.request("/health", {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example.com",
        "Access-Control-Request-Method": "GET",
      },
    });
    const acao = res.headers.get("access-control-allow-origin");
    expect(acao).not.toBe("https://evil.example.com");
  });
});
