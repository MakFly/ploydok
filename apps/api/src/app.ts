// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./env";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export const app = new Hono();

// 1. Logger middleware
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const dur = Date.now() - start;
  // Never log Authorization / Cookie / request body — no secrets.
  console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${dur}ms`);
});

// 2. CORS strict
app.use(
  "*",
  cors({
    origin: env.WEB_ORIGIN,
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE"],
    allowHeaders: ["content-type", "x-csrf-token"],
  }),
);

// 3. CSRF double-submit token (skip safe methods and the csrf-issue route)
app.use("*", async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) {
    return next();
  }

  const cookieCsrf = getCookieValue(c.req.raw.headers.get("cookie") ?? "", "csrf");
  const headerCsrf = c.req.raw.headers.get("x-csrf-token");

  if (!cookieCsrf || !headerCsrf || cookieCsrf !== headerCsrf) {
    return c.json(
      { error: { code: "CSRF_MISMATCH", message: "Invalid or missing CSRF token" } },
      403,
    );
  }

  return next();
});

// 4. Global error handler
app.onError((err, c) => {
  console.error("[error]", err.stack ?? err.message);
  const code = (err as { code?: string }).code ?? "INTERNAL_ERROR";
  const message =
    env.NODE_ENV === "prod" ? "An unexpected error occurred" : err.message;
  return c.json({ error: { code, message } }, 500);
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Health
app.get("/health", (c) => c.json({ ok: true, version: "0.0.1" }));

// CSRF token issuance — GET so it bypasses the CSRF middleware above
app.get("/auth/csrf", (c) => {
  const token = crypto.randomUUID();
  // httpOnly: false is intentional for the double-submit pattern —
  // JavaScript must be able to read the cookie to attach it as a header.
  c.header(
    "Set-Cookie",
    `csrf=${token}; Path=/; SameSite=Strict; Secure`,
  );
  return c.json({ token });
});

// Auth stubs
const NOT_IMPLEMENTED = { error: { code: "NOT_IMPLEMENTED", message: "Not implemented" } };

app.get("/auth/register/options", (c) => c.json(NOT_IMPLEMENTED, 501));
app.post("/auth/register/verify", (c) => c.json(NOT_IMPLEMENTED, 501));
app.get("/auth/login/options", (c) => c.json(NOT_IMPLEMENTED, 501));
app.post("/auth/login/verify", (c) => c.json(NOT_IMPLEMENTED, 501));
app.post("/auth/logout", (c) => c.json(NOT_IMPLEMENTED, 501));
app.post("/auth/refresh", (c) => c.json(NOT_IMPLEMENTED, 501));

// /me stub — returns 401 until session middleware is implemented (sprint 1.5)
app.get("/me", (c) =>
  c.json({ error: { code: "UNAUTHENTICATED", message: "Authentication required" } }, 401),
);

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function getCookieValue(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === name && v !== undefined) return decodeURIComponent(v);
  }
  return null;
}
