// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { Hono } from "hono"
import { z } from "zod"
import { and, eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { secrets, audit_log } from "@ploydok/db"
import { createDb } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { env } from "../env"
import { getAppForUser } from "../queries/apps"
import { encryptSecret, decryptSecret } from "../secrets/crypto"
import { requireTotpVerified } from "../auth/second-factor"
import { childLogger } from "../logger"
import type { AuthUser } from "../auth/middleware"

const execFileAsync = promisify(execFile)
const log = childLogger("secrets.routes")

// Valid secret key: UPPER_SNAKE_CASE starting with a letter
const SECRET_KEY_REGEX = /^[A-Z][A-Z0-9_]*$/

const ScopeEnum = z.enum(["shared", "prod", "preview", "dev"])

const CreateSecretBody = z.object({
  key: z.string().regex(SECRET_KEY_REGEX, "Key must be UPPER_SNAKE_CASE"),
  value: z.string().min(1),
  scope: ScopeEnum,
})

const ExportSecretBody = z.object({
  age_recipient: z.string().min(1),
})

type Scope = z.infer<typeof ScopeEnum>

type AppEnv = { Variables: { user?: AuthUser } }

function getUser(c: { get: (k: string) => unknown }): AuthUser {
  return c.get("user") as AuthUser
}

function keyHash(key: string): string {
  return createHash("sha256").update(key).digest("hex")
}

async function insertAuditLog(
  db: Db,
  userId: string,
  action: string,
  appId: string,
  keyHash: string,
): Promise<void> {
  await db.insert(audit_log).values({
    user_id: userId,
    action,
    target_type: "secret",
    target_id: appId,
    metadata: JSON.stringify({ key_hash: keyHash }),
    created_at: new Date(),
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createSecretsRouter(db: Db): Hono<any, any, any> {
  const router = new Hono<AppEnv>()
  const totpMiddleware = requireTotpVerified(db)

  // GET /:id/secrets?scope=shared|prod|preview|dev
  router.get("/:id/secrets", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")
    const scopeParam = c.req.query("scope") as Scope | undefined

    const app = await getAppForUser(db, appId!, user.id)
    if (!app) {
      return c.json({ error: { code: "NOT_FOUND", message: "App not found" } }, 404)
    }

    const conditions = [eq(secrets.app_id, appId!)]
    if (scopeParam) {
      const parsed = ScopeEnum.safeParse(scopeParam)
      if (!parsed.success) {
        return c.json({ error: { code: "VALIDATION_ERROR", message: "Invalid scope" } }, 400)
      }
      conditions.push(eq(secrets.scope, parsed.data))
    }

    const rows = await db
      .select({
        id: secrets.id,
        key: secrets.key,
        scope: secrets.scope,
        created_at: secrets.created_at,
      })
      .from(secrets)
      .where(and(...(conditions as [ReturnType<typeof eq>])))

    return c.json({
      secrets: rows.map((r) => ({
        key: r.key,
        scope: r.scope,
        updated_at: r.created_at?.toISOString() ?? null,
      })),
    })
  })

  // POST /:id/secrets — upsert (create or update by key+scope)
  router.post("/:id/secrets", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")

    const app = await getAppForUser(db, appId!, user.id)
    if (!app) {
      return c.json({ error: { code: "NOT_FOUND", message: "App not found" } }, 404)
    }

    let body: z.infer<typeof CreateSecretBody>
    try {
      body = CreateSecretBody.parse(await c.req.json())
    } catch (err) {
      return c.json({ error: { code: "VALIDATION_ERROR", message: String(err) } }, 400)
    }

    const { enc, nonce } = await encryptSecret(body.value)

    // Check if secret already exists for this key+scope
    const existing = await db
      .select({ id: secrets.id })
      .from(secrets)
      .where(and(eq(secrets.app_id, appId!), eq(secrets.key, body.key), eq(secrets.scope, body.scope)))
      .limit(1)

    const isUpdate = existing.length > 0
    const secretId = existing[0]?.id ?? nanoid()

    if (isUpdate) {
      await db
        .update(secrets)
        .set({
          value_ciphertext: enc,
          nonce,
          created_at: new Date(),
        })
        .where(eq(secrets.id, secretId))
    } else {
      await db.insert(secrets).values({
        id: secretId,
        app_id: appId,
        project_id: app.project_id,
        scope: body.scope,
        key: body.key,
        value_ciphertext: enc,
        nonce,
        created_at: new Date(),
      })
    }

    const action = isUpdate ? "secret.updated" : "secret.created"
    await insertAuditLog(db, user.id, action, appId, keyHash(body.key))

    return c.json({ key: body.key, scope: body.scope }, isUpdate ? 200 : 201)
  })

  // DELETE /:id/secrets/:key?scope=
  router.delete("/:id/secrets/:key", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")
    const key = c.req.param("key")
    const scopeParam = c.req.query("scope") as Scope | undefined

    const app = await getAppForUser(db, appId!, user.id)
    if (!app) {
      return c.json({ error: { code: "NOT_FOUND", message: "App not found" } }, 404)
    }

    if (!scopeParam) {
      return c.json({ error: { code: "VALIDATION_ERROR", message: "scope query param required" } }, 400)
    }
    const parsedScope = ScopeEnum.safeParse(scopeParam)
    if (!parsedScope.success) {
      return c.json({ error: { code: "VALIDATION_ERROR", message: "Invalid scope" } }, 400)
    }

    const deleted = await db
      .delete(secrets)
      .where(
        and(
          eq(secrets.app_id, appId!),
          eq(secrets.key, key!),
          eq(secrets.scope, parsedScope.data),
        ),
      )

    await insertAuditLog(db, user.id, "secret.deleted", appId, keyHash(key))

    return c.json({ deleted: true })
  })

  // POST /:id/secrets/:key/reveal — TOTP required
  router.post("/:id/secrets/:key/reveal", totpMiddleware, async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")
    const key = c.req.param("key")
    const scopeParam = c.req.query("scope") as Scope | undefined

    const app = await getAppForUser(db, appId!, user.id)
    if (!app) {
      return c.json({ error: { code: "NOT_FOUND", message: "App not found" } }, 404)
    }

    if (!scopeParam) {
      return c.json({ error: { code: "VALIDATION_ERROR", message: "scope query param required" } }, 400)
    }
    const parsedScope = ScopeEnum.safeParse(scopeParam)
    if (!parsedScope.success) {
      return c.json({ error: { code: "VALIDATION_ERROR", message: "Invalid scope" } }, 400)
    }

    const rows = await db
      .select()
      .from(secrets)
      .where(
        and(
          eq(secrets.app_id, appId!),
          eq(secrets.key, key!),
          eq(secrets.scope, parsedScope.data),
        ),
      )
      .limit(1)

    const row = rows[0]
    if (!row) {
      return c.json({ error: { code: "NOT_FOUND", message: "Secret not found" } }, 404)
    }

    const value = await decryptSecret(row.value_ciphertext as Buffer, row.nonce as Buffer)

    await insertAuditLog(db, user.id, "secret.revealed", appId!, keyHash(key!))

    return c.json({ value })
  })

  // POST /:id/secrets/import — multipart .env file
  router.post("/:id/secrets/import", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")

    const app = await getAppForUser(db, appId!, user.id)
    if (!app) {
      return c.json({ error: { code: "NOT_FOUND", message: "App not found" } }, 404)
    }

    const defaultScopeParam = (c.req.query("scope") ?? "shared") as Scope
    const parsedDefaultScope = ScopeEnum.safeParse(defaultScopeParam)
    if (!parsedDefaultScope.success) {
      return c.json({ error: { code: "VALIDATION_ERROR", message: "Invalid default scope" } }, 400)
    }
    const defaultScope = parsedDefaultScope.data

    let rawContent: string
    const contentType = c.req.header("content-type") ?? ""

    if (contentType.includes("multipart/form-data")) {
      const formData = await c.req.formData()
      const file = formData.get("file")
      if (!file || typeof file === "string") {
        return c.json({ error: { code: "VALIDATION_ERROR", message: "Missing file field" } }, 400)
      }
      rawContent = await (file as File).text()
    } else if (contentType.includes("application/json")) {
      const json = await c.req.json<{ content?: string }>()
      if (!json.content) {
        return c.json({ error: { code: "VALIDATION_ERROR", message: "Missing content field" } }, 400)
      }
      rawContent = json.content
    } else {
      // Accept raw text/plain body as well
      rawContent = await c.req.text()
    }

    const parsed = parseDotenv(rawContent, defaultScope)
    if (parsed.length === 0) {
      return c.json({ imported: 0 })
    }

    let imported = 0
    for (const { key, value, scope } of parsed) {
      const { enc, nonce } = await encryptSecret(value)

      const existing = await db
        .select({ id: secrets.id })
        .from(secrets)
        .where(and(eq(secrets.app_id, appId!), eq(secrets.key, key!), eq(secrets.scope, scope)))
        .limit(1)

      if (existing.length > 0) {
        await db
          .update(secrets)
          .set({ value_ciphertext: enc, nonce, created_at: new Date() })
          .where(eq(secrets.id, existing[0]!.id))
      } else {
        await db.insert(secrets).values({
          id: nanoid(),
          app_id: appId,
          project_id: app.project_id,
          scope,
          key,
          value_ciphertext: enc,
          nonce,
          created_at: new Date(),
        })
      }
      imported++
    }

    await insertAuditLog(db, user.id, "secret.imported", appId, `count:${imported}`)
    log.info({ appId, imported }, "secrets imported")

    return c.json({ imported })
  })

  // GET /:id/secrets/export?scope=&age_recipient=
  router.get("/:id/secrets/export", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")

    const app = await getAppForUser(db, appId!, user.id)
    if (!app) {
      return c.json({ error: { code: "NOT_FOUND", message: "App not found" } }, 404)
    }

    const scopeParam = c.req.query("scope") as Scope | undefined
    const ageRecipient = c.req.query("age_recipient")

    if (!ageRecipient) {
      return c.json({ error: { code: "VALIDATION_ERROR", message: "age_recipient query param required" } }, 400)
    }

    // Check age binary is available
    try {
      await execFileAsync("age", ["--version"])
    } catch {
      return c.json(
        { error: { code: "NOT_IMPLEMENTED", message: "age binary not installed on this server" } },
        501,
      )
    }

    const conditions = [eq(secrets.app_id, appId!)]
    if (scopeParam) {
      const parsed = ScopeEnum.safeParse(scopeParam)
      if (!parsed.success) {
        return c.json({ error: { code: "VALIDATION_ERROR", message: "Invalid scope" } }, 400)
      }
      conditions.push(eq(secrets.scope, parsed.data))
    }

    const rows = await db
      .select()
      .from(secrets)
      .where(and(...(conditions as [ReturnType<typeof eq>])))

    // Decrypt all secrets to build .env content
    const lines: string[] = []
    for (const row of rows) {
      const value = await decryptSecret(row.value_ciphertext as Buffer, row.nonce as Buffer)
      const escaped = value.replace(/\n/g, "\\n")
      lines.push(`${row.key}=${escaped}`)
    }
    const dotenvContent = lines.join("\n")

    // Encrypt with age
    let encrypted: string
    try {
      const { stdout } = await execFileAsync("age", ["-r", ageRecipient, "--armor"], {
        input: dotenvContent,
      } as Parameters<typeof execFileAsync>[2] & { input: string })
      encrypted = typeof stdout === "string" ? stdout : stdout.toString("utf8")
    } catch (err) {
      log.error({ err, appId }, "age encryption failed")
      return c.json({ error: { code: "INTERNAL_ERROR", message: "Encryption failed" } }, 500)
    }

    await insertAuditLog(db, user.id, "secret.exported", appId, `count:${rows.length}`)

    c.header("Content-Type", "text/plain")
    c.header("Content-Disposition", `attachment; filename="secrets-${appId}.env.age"`)
    return c.body(encrypted)
  })

  return router
}

// ---------------------------------------------------------------------------
// .env parser — tolerant of comments, blank lines, quotes, escapes
// ---------------------------------------------------------------------------

function parseDotenv(
  content: string,
  defaultScope: Scope,
): { key: string; value: string; scope: Scope }[] {
  const results: { key: string; value: string; scope: Scope }[] = []
  const lines = content.split(/\r?\n/)
  let currentScope: Scope = defaultScope

  for (const rawLine of lines) {
    const line = rawLine.trim()

    // Blank or comment
    if (!line || line.startsWith("#")) {
      // Detect scope directive in comment: # @scope prod
      const scopeDirective = line.match(/^#\s*@scope\s+(\w+)/)
      if (scopeDirective) {
        const parsed = ScopeEnum.safeParse(scopeDirective[1])
        if (parsed.success) currentScope = parsed.data
      }
      continue
    }

    // Scope prefix: @scope KEY=VALUE
    const scopePrefixed = line.match(/^@(\w+)\s+([A-Z][A-Z0-9_]*)=(.*)$/)
    if (scopePrefixed) {
      const parsedScope = ScopeEnum.safeParse(scopePrefixed[1])
      if (parsedScope.success) {
        const value = unquote(scopePrefixed[3] ?? "")
        results.push({ key: scopePrefixed[2]!, value, scope: parsedScope.data })
        continue
      }
    }

    // Standard KEY=VALUE
    const eqIndex = line.indexOf("=")
    if (eqIndex === -1) continue

    const key = line.slice(0, eqIndex).trim()
    const rawValue = line.slice(eqIndex + 1)

    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) continue

    results.push({ key, value: unquote(rawValue), scope: currentScope })
  }

  return results
}

function unquote(raw: string): string {
  const trimmed = raw.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\\\/g, "\\")
      .replace(/\\"/g, '"')
  }
  // Strip inline comment for unquoted values
  const commentIdx = trimmed.indexOf(" #")
  if (commentIdx !== -1) {
    return trimmed.slice(0, commentIdx).trim()
  }
  return trimmed
}

// ---------------------------------------------------------------------------
// Prod singleton
// ---------------------------------------------------------------------------

const prodDb = createDb(env.DATABASE_URL)
export const secretsRouter = createSecretsRouter(prodDb)
