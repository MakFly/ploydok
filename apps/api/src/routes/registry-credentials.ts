// SPDX-License-Identifier: AGPL-3.0-only
import { Hono } from "hono";
import { createDb } from "@ploydok/db";
import {
  deleteRegistryCredential,
  insertRegistryCredential,
  listRegistryCredentials,
} from "@ploydok/db/queries";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { AuthUser } from "../auth/middleware";
import { decryptField, encryptField } from "../github/app-credentials";
import { childLogger } from "../logger";
import { env } from "../env";

const log = childLogger("registry.routes");

type Env = { Variables: { user?: AuthUser } };
export const registryCredentialsRouter = new Hono<Env>();

const db = createDb(env.DATABASE_URL);

const CreateBody = z.object({
  label: z.string().min(1).max(64),
  registryHost: z.string().min(1).max(256),
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(512),
});

registryCredentialsRouter.get("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "unauthenticated" }, 401);

  const rows = await listRegistryCredentials(db, user.id);
  return c.json({
    credentials: rows.map((r) => ({
      id: r.id,
      label: r.label,
      registryHost: r.registry_host,
      username: r.username,
      createdAt: r.created_at?.toISOString(),
    })),
  });
});

registryCredentialsRouter.post("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "unauthenticated" }, 401);

  const body = await c.req.json().catch(() => null);
  const parsed = CreateBody.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body", details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;

  // Optional dry-run: GET {host}/v2/ with basic auth to confirm credentials work.
  const baseUrl = input.registryHost.startsWith("http")
    ? input.registryHost
    : `https://${input.registryHost}`;
  try {
    const basic = Buffer.from(`${input.username}:${input.password}`).toString("base64");
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/v2/`, {
      headers: { Authorization: `Basic ${basic}` },
    });
    if (res.status === 401 || res.status === 403) {
      return c.json({ error: "invalid_credentials", status: res.status }, 400);
    }
    // 200 (anonymous-allowed) or 200 with auth — both acceptable.
  } catch (err) {
    log.warn({ err, host: input.registryHost }, "registry probe failed");
    // Don't hard-fail on network errors — user may be registering for a private
    // network registry unreachable from the API host. Record a warning only.
  }

  const enc = await encryptField(input.password);
  const id = nanoid();
  await insertRegistryCredential(db, {
    id,
    user_id: user.id,
    label: input.label,
    registry_host: input.registryHost,
    username: input.username,
    password_enc: enc.enc,
    password_nonce: enc.nonce,
  });

  return c.json({ id, label: input.label, registryHost: input.registryHost, username: input.username }, 201);
});

registryCredentialsRouter.delete("/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const ok = await deleteRegistryCredential(db, user.id, c.req.param("id"));
  if (!ok) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Internal helper — decrypts a credential for the worker / image-pull.
// Not exposed as a route.
// ---------------------------------------------------------------------------

export async function getRegistryAuthForCredential(
  db_: ReturnType<typeof createDb>,
  userId: string,
  credentialId: string,
): Promise<{ username: string; password: string; host: string } | null> {
  const { getRegistryCredential } = await import("@ploydok/db/queries");
  const row = await getRegistryCredential(db_, userId, credentialId);
  if (!row) return null;
  const password = await decryptField(
    row.password_enc as Buffer,
    row.password_nonce as Buffer,
  );
  return { username: row.username, password, host: row.registry_host };
}
