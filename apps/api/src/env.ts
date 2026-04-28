// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from "node:crypto"
import { z } from "zod"

const schema = z.object({
  NODE_ENV: z.enum(["dev", "prod", "test"]).default("dev"),
  PORT: z.coerce.number().default(3335),
  SESSION_SECRET: z.string().min(32).optional(),
  MASTER_KEY: z.string().optional(),
  DATABASE_URL: z
    .string()
    .default("postgres://ploydok:ploydok@127.0.0.1:5432/ploydok"),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379/0"),
  PLOYDOK_PG_PASSWORD: z.string().optional(),
  PLOYDOK_REDIS_PASSWORD: z.string().optional(),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_FROM: z.string().default("Ploydok <noreply@ploydok.local>"),
  GITHUB_APP_CALLBACK_URL: z
    .string()
    .url()
    .optional()
    .default("http://localhost:3335/github/app/callback"),
  GITLAB_OAUTH_CALLBACK_URL: z
    .string()
    .url()
    .optional()
    .default("http://localhost:3335/gitlab/callback"),
  PLOYDOK_REGISTRY_URL: z.string().default("127.0.0.1:5000"),
  PLOYDOK_REGISTRY_PUSH_URL: z.string().default("registry:5000"),
  PLOYDOK_REGISTRY_USER: z.string().optional(),
  PLOYDOK_REGISTRY_PASS: z.string().optional(),
  PLOYDOK_BUILD_DIR: z.string().default(() => {
    const home = process.env.HOME ?? "/tmp"
    return `${home}/.ploydok-dev/builds`
  }),
  PLOYDOK_BUILDKIT_ADDR: z
    .string()
    .default("docker-container://ploydok-buildkitd"),
  PLOYDOK_DEPLOY_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  PLOYDOK_PUBLIC_SCHEME: z.enum(["http", "https"]).optional(),
  PLOYDOK_PUBLIC_PORT: z.coerce.number().int().positive().optional(),
  PLOYDOK_PUBLIC_HOST: z.string().min(1).optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRO_PRICE_ID: z.string().optional(),
  STRIPE_ENTERPRISE_PRICE_ID: z.string().optional(),
  PLOYDOK_CVE_SCAN: z.enum(["on", "off"]).default("on"),
})

const raw = schema.parse({
  NODE_ENV: Bun.env["NODE_ENV"],
  PORT: Bun.env["PORT"],
  SESSION_SECRET: Bun.env["SESSION_SECRET"],
  MASTER_KEY: Bun.env["MASTER_KEY"],
  DATABASE_URL: Bun.env["DATABASE_URL"],
  REDIS_URL: Bun.env["REDIS_URL"],
  PLOYDOK_PG_PASSWORD: Bun.env["PLOYDOK_PG_PASSWORD"],
  PLOYDOK_REDIS_PASSWORD: Bun.env["PLOYDOK_REDIS_PASSWORD"],
  WEB_ORIGIN: Bun.env["WEB_ORIGIN"],
  SMTP_HOST: Bun.env["SMTP_HOST"],
  SMTP_PORT: Bun.env["SMTP_PORT"],
  SMTP_USER: Bun.env["SMTP_USER"],
  SMTP_PASS: Bun.env["SMTP_PASS"],
  SMTP_SECURE: Bun.env["SMTP_SECURE"],
  SMTP_FROM: Bun.env["SMTP_FROM"],
  GITHUB_APP_CALLBACK_URL: Bun.env["GITHUB_APP_CALLBACK_URL"],
  GITLAB_OAUTH_CALLBACK_URL: Bun.env["GITLAB_OAUTH_CALLBACK_URL"],
  PLOYDOK_REGISTRY_URL: Bun.env["PLOYDOK_REGISTRY_URL"],
  PLOYDOK_REGISTRY_PUSH_URL: Bun.env["PLOYDOK_REGISTRY_PUSH_URL"],
  PLOYDOK_REGISTRY_USER: Bun.env["PLOYDOK_REGISTRY_USER"],
  PLOYDOK_REGISTRY_PASS: Bun.env["PLOYDOK_REGISTRY_PASS"],
  PLOYDOK_BUILD_DIR: Bun.env["PLOYDOK_BUILD_DIR"],
  PLOYDOK_BUILDKIT_ADDR: Bun.env["PLOYDOK_BUILDKIT_ADDR"],
  PLOYDOK_DEPLOY_CONCURRENCY: Bun.env["PLOYDOK_DEPLOY_CONCURRENCY"],
  PLOYDOK_PUBLIC_SCHEME: Bun.env["PLOYDOK_PUBLIC_SCHEME"],
  PLOYDOK_PUBLIC_PORT: Bun.env["PLOYDOK_PUBLIC_PORT"],
  PLOYDOK_PUBLIC_HOST: Bun.env["PLOYDOK_PUBLIC_HOST"],
  STRIPE_SECRET_KEY: Bun.env["STRIPE_SECRET_KEY"],
  STRIPE_WEBHOOK_SECRET: Bun.env["STRIPE_WEBHOOK_SECRET"],
  STRIPE_PRO_PRICE_ID: Bun.env["STRIPE_PRO_PRICE_ID"],
  STRIPE_ENTERPRISE_PRICE_ID: Bun.env["STRIPE_ENTERPRISE_PRICE_ID"],
  PLOYDOK_CVE_SCAN: Bun.env["PLOYDOK_CVE_SCAN"],
})

const isProd = raw.NODE_ENV === "prod"

// En dev : les secrets doivent venir de apps/api/.env.local (auto-chargé par Bun).
// Si absent, on génère à chaque boot — ce qui invalide les JWT au reload, donc on
// LOGGUE un avertissement clair pour que le dev sache quoi faire.
function requireProdOrGenerate(
  value: string | undefined,
  name: string,
  generator: () => string
): string {
  if (isProd) {
    if (!value) {
      throw new Error(`[env] ${name} is required in production`)
    }
    return value
  }
  if (value) return value
  // eslint-disable-next-line no-console
  console.warn(
    `[env] ${name} absent de .env.local — un secret aléatoire est généré pour ce boot. ` +
      `Les JWT seront invalidés au prochain reload. Ajoute ${name} à apps/api/.env.local pour stabiliser.`
  )
  return generator()
}

const SESSION_SECRET = requireProdOrGenerate(
  raw.SESSION_SECRET,
  "SESSION_SECRET",
  () => randomBytes(32).toString("hex")
)

const MASTER_KEY = requireProdOrGenerate(raw.MASTER_KEY, "MASTER_KEY", () =>
  randomBytes(32).toString("base64")
)

const sessionSecretParsed = z.string().min(32).safeParse(SESSION_SECRET)
if (!sessionSecretParsed.success) {
  throw new Error("[env] SESSION_SECRET must be at least 32 characters")
}

// Warn in dev if DATABASE_URL still looks like a SQLite path
if (raw.NODE_ENV !== "prod" && !raw.DATABASE_URL.startsWith("postgres")) {
  // eslint-disable-next-line no-console
  console.warn(
    "[env] DATABASE_URL does not look like a Postgres URL. Run `make secrets-init` to generate one."
  )
}

export const env = {
  NODE_ENV: raw.NODE_ENV,
  PORT: raw.PORT,
  SESSION_SECRET,
  MASTER_KEY,
  DATABASE_URL: raw.DATABASE_URL,
  REDIS_URL: raw.REDIS_URL,
  PLOYDOK_PG_PASSWORD: raw.PLOYDOK_PG_PASSWORD,
  PLOYDOK_REDIS_PASSWORD: raw.PLOYDOK_REDIS_PASSWORD,
  WEB_ORIGIN: raw.WEB_ORIGIN,
  SMTP_HOST: raw.SMTP_HOST,
  SMTP_PORT: raw.SMTP_PORT,
  SMTP_USER: raw.SMTP_USER,
  SMTP_PASS: raw.SMTP_PASS,
  SMTP_SECURE: raw.SMTP_SECURE,
  SMTP_FROM: raw.SMTP_FROM,
  GITHUB_APP_CALLBACK_URL: raw.GITHUB_APP_CALLBACK_URL,
  GITLAB_OAUTH_CALLBACK_URL: raw.GITLAB_OAUTH_CALLBACK_URL,
  PLOYDOK_REGISTRY_URL: raw.PLOYDOK_REGISTRY_URL,
  PLOYDOK_REGISTRY_PUSH_URL: raw.PLOYDOK_REGISTRY_PUSH_URL,
  PLOYDOK_REGISTRY_USER: raw.PLOYDOK_REGISTRY_USER,
  PLOYDOK_REGISTRY_PASS: raw.PLOYDOK_REGISTRY_PASS,
  PLOYDOK_BUILD_DIR: raw.PLOYDOK_BUILD_DIR,
  PLOYDOK_BUILDKIT_ADDR: raw.PLOYDOK_BUILDKIT_ADDR,
  PLOYDOK_DEPLOY_CONCURRENCY: raw.PLOYDOK_DEPLOY_CONCURRENCY,
  PLOYDOK_PUBLIC_SCHEME:
    raw.PLOYDOK_PUBLIC_SCHEME ?? (isProd ? "https" : "http"),
  PLOYDOK_PUBLIC_PORT: raw.PLOYDOK_PUBLIC_PORT ?? (isProd ? undefined : 8180),
  PLOYDOK_PUBLIC_HOST: raw.PLOYDOK_PUBLIC_HOST ?? "localhost",
  STRIPE_SECRET_KEY: raw.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: raw.STRIPE_WEBHOOK_SECRET,
  STRIPE_PRO_PRICE_ID: raw.STRIPE_PRO_PRICE_ID,
  STRIPE_ENTERPRISE_PRICE_ID: raw.STRIPE_ENTERPRISE_PRICE_ID,
  PLOYDOK_CVE_SCAN: raw.PLOYDOK_CVE_SCAN,
} as const
