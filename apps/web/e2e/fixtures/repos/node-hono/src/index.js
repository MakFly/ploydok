// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono"

const app = new Hono()

app.get("/", (c) =>
  c.json({
    ok: true,
    version: Bun.env["PLOYDOK_COMMIT_SHA"] ?? Bun.env["APP_VERSION"] ?? "dev",
  })
)

app.get("/health", (c) => c.json({ ok: true }))

Bun.serve({
  port: Number(Bun.env["PORT"] ?? "3000"),
  fetch: app.fetch,
})
