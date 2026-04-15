// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test";
import { app } from "./app";

describe("CSRF", () => {
  it("POST without csrf header/cookie returns 403", async () => {
    const res = await app.request("/auth/logout", {
      method: "POST",
    });
    expect(res.status).toBe(403);
  });

  it("GET /auth/csrf sets csrf cookie and returns token", async () => {
    const res = await app.request("/auth/csrf");
    expect(res.status).toBe(200);

    const body = (await res.json()) as { token: string };
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThan(0);

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).not.toBeNull();
    expect(setCookie).toContain("csrf=");
  });

  it("POST with matching csrf cookie + header passes CSRF check (returns 501, not 403)", async () => {
    // First get a token
    const csrfRes = await app.request("/auth/csrf");
    const { token } = (await csrfRes.json()) as { token: string };

    const res = await app.request("/auth/logout", {
      method: "POST",
      headers: {
        Cookie: `csrf=${token}`,
        "x-csrf-token": token,
      },
    });

    // The route returns 501 NOT_IMPLEMENTED, meaning CSRF check passed
    expect(res.status).toBe(501);
  });

  it("POST with mismatched csrf cookie and header returns 403", async () => {
    const res = await app.request("/auth/logout", {
      method: "POST",
      headers: {
        Cookie: "csrf=aaaa-bbbb",
        "x-csrf-token": "xxxx-yyyy",
      },
    });
    expect(res.status).toBe(403);
  });
});
