// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono"
import { z } from "zod"
import { createDb } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { env } from "../env"
import { getAppForUser } from "../queries/apps"
import { listEnvForApp, upsertEnvVars } from "../queries/env"
import type { AuthUser } from "../auth/middleware"
import { requireSecondFactor } from "../auth/middleware"
import type { EnvVarRow } from "../queries/env"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Mask value used in API responses for secret variables.
 *
 * MVP trade-off: env var values are stored **in plain text** in SQLite.
 * This is intentional for the MVP — implementing encrypt-at-rest via MASTER_KEY
 * (keyring.ts) is planned for a future sprint. The `secret` flag only controls
 * UI masking; it does NOT provide cryptographic protection at rest today.
 *
 * Roadmap: before GA, values with `secret = 1` should be encrypted at rest
 * using AES-GCM with the MASTER_KEY from apps/api/src/keyring.ts, matching
 * the pattern used for the `secrets` table in packages/db/src/schema/secrets.ts.
 */
const SECRET_MASK = "********"

/**
 * Valid env var key: UPPER_SNAKE_CASE starting with a letter.
 * Matches the convention used by most PaaS platforms (Heroku, Fly, Dokploy).
 */
const ENV_KEY_REGEX = /^[A-Z][A-Z0-9_]*$/

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const EnvVarItemSchema = z.object({
  key: z.string().regex(ENV_KEY_REGEX, "Key must be UPPER_SNAKE_CASE (e.g. MY_VAR)"),
  value: z.string(),
  secret: z.boolean().optional().default(false),
})

const PatchEnvBody = z.object({
  vars: z.array(EnvVarItemSchema),
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getUser(c: { get: (key: string) => unknown }): AuthUser {
  return c.get("user") as AuthUser
}

/**
 * Serialize an env var row for the API response.
 * Secret values are replaced with the mask string — the client must use the
 * "Reveal" toggle, which is a local-only UI action (no extra request).
 */
function serializeEnvVar(row: EnvVarRow, reveal = false) {
  return {
    key: row.key,
    value: row.secret && !reveal ? SECRET_MASK : row.value,
    secret: Boolean(row.secret),
  }
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function createAppsEnvRouter(db: Db): Hono {
  const router = new Hono()

  const sf = requireSecondFactor(db)

  // -------------------------------------------------------------------------
  // GET /:id/env — List env vars for an app (secrets masked)
  // -------------------------------------------------------------------------

  router.get("/:id/env", async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json({ error: { code: "NOT_FOUND", message: "App not found" } }, 404)
    }

    const rows = await listEnvForApp(db, appId)

    return c.json({
      vars: rows.map((r) => serializeEnvVar(r)),
    })
  })

  // -------------------------------------------------------------------------
  // PATCH /:id/env — Replace the entire env var set for an app
  // -------------------------------------------------------------------------

  router.patch("/:id/env", sf, async (c) => {
    const user = getUser(c)
    const appId = c.req.param("id")!

    const app = await getAppForUser(db, appId, user.id)
    if (!app) {
      return c.json({ error: { code: "NOT_FOUND", message: "App not found" } }, 404)
    }

    let body: z.infer<typeof PatchEnvBody>
    try {
      body = PatchEnvBody.parse(await c.req.json())
    } catch (err) {
      return c.json({ error: { code: "VALIDATION_ERROR", message: String(err) } }, 400)
    }

    // Additional check: no duplicate keys in the submitted list.
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
          400,
        )
      }
      seenKeys.add(v.key)
    }

    const rows = await upsertEnvVars(db, appId, body.vars)

    return c.json({
      vars: rows.map((r) => serializeEnvVar(r)),
    })
  })

  return router
}

// ---------------------------------------------------------------------------
// Prod singleton
// ---------------------------------------------------------------------------

const prodDb = createDb(env.DATABASE_URL)
export const appsEnvRouter = createAppsEnvRouter(prodDb)
