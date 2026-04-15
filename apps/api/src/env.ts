// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from "node:crypto";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["dev", "prod", "test"]).default("dev"),
  PORT: z.coerce.number().default(3001),
  SESSION_SECRET: z.string().min(32).optional(),
  MASTER_KEY: z.string().optional(),
  DATABASE_URL: z.string().default("./ploydok.db"),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
});

const raw = schema.parse({
  NODE_ENV: Bun.env["NODE_ENV"],
  PORT: Bun.env["PORT"],
  SESSION_SECRET: Bun.env["SESSION_SECRET"],
  MASTER_KEY: Bun.env["MASTER_KEY"],
  DATABASE_URL: Bun.env["DATABASE_URL"],
  WEB_ORIGIN: Bun.env["WEB_ORIGIN"],
});

const isProd = raw.NODE_ENV === "prod";

function requireProdOrGenerate(
  value: string | undefined,
  name: string,
  generator: () => string,
): string {
  if (isProd) {
    if (!value) {
      throw new Error(`[env] ${name} is required in production`);
    }
    return value;
  }
  return value ?? generator();
}

const SESSION_SECRET = requireProdOrGenerate(
  raw.SESSION_SECRET,
  "SESSION_SECRET",
  () => randomBytes(32).toString("hex"),
);

const MASTER_KEY = requireProdOrGenerate(
  raw.MASTER_KEY,
  "MASTER_KEY",
  () => randomBytes(32).toString("base64"),
);

const sessionSecretParsed = z.string().min(32).safeParse(SESSION_SECRET);
if (!sessionSecretParsed.success) {
  throw new Error("[env] SESSION_SECRET must be at least 32 characters");
}

export const env = {
  NODE_ENV: raw.NODE_ENV,
  PORT: raw.PORT,
  SESSION_SECRET,
  MASTER_KEY,
  DATABASE_URL: raw.DATABASE_URL,
  WEB_ORIGIN: raw.WEB_ORIGIN,
} as const;
