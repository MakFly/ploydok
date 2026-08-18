// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono"
import { z } from "zod"
import type { MiddlewareHandler } from "hono"
import { createDb } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { env } from "../env"
import {
  listProjectEnv,
  upsertProjectEnv,
  deleteProjectEnv,
} from "@ploydok/db/queries"
import { encryptField, decryptField } from "../github/app-credentials"
import type { AuthUser } from "../auth/middleware"
import { requireSecondFactor } from "../auth/middleware"
import { getProjectForOwner, getProjectForUser } from "@ploydok/db/queries"

const SECRET_MASK = "***"

const ENV_KEY_REGEX = /^[A-Z][A-Z0-9_]*$/

const ProjectEnvVarItemSchema = z.object({
  key: z
    .string()
    .regex(ENV_KEY_REGEX, "Key must be UPPER_SNAKE_CASE (e.g. MY_VAR)"),
  value: z.string(),
  isSecret: z.boolean().optional().default(true),
})

const PutProjectEnvBody = z.object({
  vars: z.array(ProjectEnvVarItemSchema),
})

function getUser(c: { get: (key: string) => unknown }): AuthUser {
  return c.get("user") as AuthUser
}

function serializeProjectEnvVar(
  row: { key: string; is_secret: boolean; updated_at: Date },
  value: string,
  reveal = false
) {
  return {
    key: row.key,
    // The list endpoint is metadata-only for every role. Even a value marked
    // non-secret can affect every deployment in the workspace, so clear text
    // is returned exclusively by the owner-only reveal endpoint.
    value: reveal ? value : SECRET_MASK,
    isSecret: Boolean(row.is_secret),
    updatedAt: row.updated_at.toISOString(),
  }
}

export function createProjectEnvRouter(db: Db): Hono {
  const router = new Hono()

  const sf = requireSecondFactor(db)
  const projectNotFound = (c: Parameters<MiddlewareHandler>[0]) =>
    c.json(
      { error: { code: "NOT_FOUND", message: "Project not found" } },
      404
    )

  const belongsToWorkspace = (
    c: Parameters<MiddlewareHandler>[0],
    project: { slug: string }
  ) => {
    const orgSlug = c.req.param("orgSlug")
    return !orgSlug || project.slug === orgSlug
  }

  // Unknown projects, foreign workspaces and non-owner memberships deliberately
  // share the same 404 response so this secret-management surface cannot be
  // used to enumerate resources across tenants.
  const ownerOnly: MiddlewareHandler = async (c, next) => {
    const user = getUser(c)
    const projectId = c.req.param("projectId")!
    const project = await getProjectForOwner(db, projectId, user.id)

    if (!project || !belongsToWorkspace(c, project)) {
      return projectNotFound(c)
    }

    return next()
  }

  // -------------------------------------------------------------------------
  // GET /orgs/:orgSlug/shared-env — List project env vars (secrets masked)
  // -------------------------------------------------------------------------

  router.get("/:projectId/env", async (c) => {
    const user = getUser(c)
    const projectId = c.req.param("projectId")!

    const project = await getProjectForUser(db, projectId, user.id)
    if (!project || !belongsToWorkspace(c, project)) {
      return projectNotFound(c)
    }

    const rows = await listProjectEnv(db, projectId)
    const vars = []

    for (const row of rows) vars.push(serializeProjectEnvVar(row, SECRET_MASK))

    return c.json({ vars })
  })

  // -------------------------------------------------------------------------
  // GET /:projectId/env/reveal/:key — Reveal a secret env var (requires 2FA)
  // -------------------------------------------------------------------------

  router.get("/:projectId/env/reveal/:key", ownerOnly, sf, async (c) => {
    const projectId = c.req.param("projectId")!
    const key = c.req.param("key")!

    const rows = await listProjectEnv(db, projectId)
    const row = rows.find((r) => r.key === key)

    if (!row) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Env var not found" } },
        404
      )
    }

    if (!row.is_secret) {
      const value = await decryptField(row.value_enc, row.value_nonce)
      return c.json({ value })
    }

    const value = await decryptField(row.value_enc, row.value_nonce)
    return c.json({ value })
  })

  // -------------------------------------------------------------------------
  // PUT /orgs/:orgSlug/shared-env — Upsert/replace project env vars
  // -------------------------------------------------------------------------

  router.put("/:projectId/env", ownerOnly, sf, async (c) => {
    const projectId = c.req.param("projectId")!

    let body: z.infer<typeof PutProjectEnvBody>
    try {
      body = PutProjectEnvBody.parse(await c.req.json())
    } catch (err) {
      return c.json(
        { error: { code: "VALIDATION_ERROR", message: String(err) } },
        400
      )
    }

    // Check for duplicate keys
    const seenKeys = new Set<string>()
    for (const v of body.vars) {
      if (seenKeys.has(v.key)) {
        return c.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: `Duplicate key: ${v.key}`,
            },
          },
          400
        )
      }
      seenKeys.add(v.key)
    }

    // Encrypt and upsert each var
    const vars = []
    for (const v of body.vars) {
      const { enc, nonce } = await encryptField(v.value)
      const row = await upsertProjectEnv(db, projectId, {
        key: v.key,
        valueEnc: enc,
        valueNonce: nonce,
        isSecret: v.isSecret,
      })
      const value = await decryptField(row.value_enc, row.value_nonce)
      vars.push(serializeProjectEnvVar(row, value))
    }

    return c.json({ vars })
  })

  // -------------------------------------------------------------------------
  // DELETE /:projectId/env/:key — Delete a project env var
  // -------------------------------------------------------------------------

  router.delete("/:projectId/env/:key", ownerOnly, sf, async (c) => {
    const projectId = c.req.param("projectId")!
    const key = c.req.param("key")!

    await deleteProjectEnv(db, projectId, key)
    return c.json({ success: true })
  })

  return router
}

const prodDb = createDb(env.DATABASE_URL)
export const projectEnvRouter = createProjectEnvRouter(prodDb)
