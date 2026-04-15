// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono";
import { cors } from "hono/cors";
import { eq } from "drizzle-orm";
import { env } from "./env";
import { createDb } from "@ploydok/db";
import { users, passkeys } from "@ploydok/db";
import { createAuthRouter } from "./routes/auth";
import { requireAuth, type AuthUser } from "./auth/middleware";
import { countActive } from "./auth/backup-codes";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// ---------------------------------------------------------------------------
// DB instance (singleton for the app)
// ---------------------------------------------------------------------------

const db = createDb(env.DATABASE_URL);

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

// Auth routes (replaces stubs)
const authRouter = createAuthRouter(db);
app.route("/", authRouter);

// /me — requires auth
app.get("/me", requireAuth(db), async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user = (c as any).get("user") as AuthUser;

  const passkeyRows = await db
    .select({ id: passkeys.id })
    .from(passkeys)
    .where(eq(passkeys.user_id, user.id));

  const passkeyCount = passkeyRows.length;
  const backupCount = await countActive(db, user.id);

  const userRows = await db
    .select()
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  const fullUser = userRows[0];
  if (!fullUser) {
    return c.json({ error: { code: "NOT_FOUND", message: "User not found" } }, 404);
  }

  return c.json({
    id: fullUser.id,
    email: fullUser.email,
    display_name: fullUser.display_name,
    created_at: fullUser.created_at?.toISOString(),
    has_passkey_plus: passkeyCount >= 2,
    has_backup_codes: backupCount >= 1,
    needs_second_factor: passkeyCount < 2 && backupCount < 1,
  });
});

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
