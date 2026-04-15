// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from "node:crypto";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["dev", "prod", "test"]).default("dev"),
  PORT: z.coerce.number().default(4000),
  SESSION_SECRET: z.string().min(32).optional(),
  MASTER_KEY: z.string().optional(),
  DATABASE_URL: z.string().default("../../ploydok.db"),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_FROM: z.string().default("Ploydok <noreply@ploydok.local>"),
});

const raw = schema.parse({
  NODE_ENV: Bun.env["NODE_ENV"],
  PORT: Bun.env["PORT"],
  SESSION_SECRET: Bun.env["SESSION_SECRET"],
  MASTER_KEY: Bun.env["MASTER_KEY"],
  DATABASE_URL: Bun.env["DATABASE_URL"],
  WEB_ORIGIN: Bun.env["WEB_ORIGIN"],
  SMTP_HOST: Bun.env["SMTP_HOST"],
  SMTP_PORT: Bun.env["SMTP_PORT"],
  SMTP_USER: Bun.env["SMTP_USER"],
  SMTP_PASS: Bun.env["SMTP_PASS"],
  SMTP_SECURE: Bun.env["SMTP_SECURE"],
  SMTP_FROM: Bun.env["SMTP_FROM"],
});

const isProd = raw.NODE_ENV === "prod";

// En dev : les secrets doivent venir de apps/api/.env.local (auto-chargé par Bun).
// Si absent, on génère à chaque boot — ce qui invalide les JWT au reload, donc on
// LOGGUE un avertissement clair pour que le dev sache quoi faire.
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
  if (value) return value;
  // eslint-disable-next-line no-console
  console.warn(
    `[env] ${name} absent de .env.local — un secret aléatoire est généré pour ce boot. ` +
      `Les JWT seront invalidés au prochain reload. Ajoute ${name} à apps/api/.env.local pour stabiliser.`,
  );
  return generator();
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
  SMTP_HOST: raw.SMTP_HOST,
  SMTP_PORT: raw.SMTP_PORT,
  SMTP_USER: raw.SMTP_USER,
  SMTP_PASS: raw.SMTP_PASS,
  SMTP_SECURE: raw.SMTP_SECURE,
  SMTP_FROM: raw.SMTP_FROM,
} as const;
