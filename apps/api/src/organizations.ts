// SPDX-License-Identifier: AGPL-3.0-only
import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { projects } from "@ploydok/db";
import type { Db } from "@ploydok/db";

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  is_default: boolean;
  created_at: string;
}

function slugifyOrganizationName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function buildDefaultOrganizationName(displayName: string | null | undefined): string {
  const normalized = displayName?.trim();
  return normalized && normalized.length > 0 ? normalized : "My Organization";
}

async function uniqueOrganizationSlug(db: Db, baseName: string): Promise<string> {
  const base = slugifyOrganizationName(baseName) || "workspace";
  let candidate = base;
  let attempt = 1;
  for (;;) {
    const existing = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.slug, candidate))
      .limit(1);

    if (!existing[0]) return candidate;
    attempt += 1;
    candidate = `${base}-${attempt}`;
  }
}

function toSummary(row: typeof projects.$inferSelect): OrganizationSummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    is_default: row.is_default,
    created_at: row.created_at.toISOString(),
  };
}

export async function ensureDefaultOrganizationForUser(
  db: Db,
  userId: string,
  displayName?: string | null,
): Promise<typeof projects.$inferSelect> {
  const existingDefault = await db
    .select()
    .from(projects)
    .where(and(eq(projects.owner_id, userId), eq(projects.is_default, true)))
    .orderBy(asc(projects.created_at), asc(projects.id))
    .limit(1);

  if (existingDefault[0]) return existingDefault[0];

  const oldest = await db
    .select()
    .from(projects)
    .where(eq(projects.owner_id, userId))
    .orderBy(asc(projects.created_at), asc(projects.id))
    .limit(1);

  if (oldest[0]) {
    await db.update(projects).set({ is_default: true }).where(eq(projects.id, oldest[0].id));
    return { ...oldest[0], is_default: true };
  }

  const now = new Date();
  const name = buildDefaultOrganizationName(displayName);
  const row: typeof projects.$inferInsert = {
    id: nanoid(),
    owner_id: userId,
    name,
    slug: await uniqueOrganizationSlug(db, name),
    is_default: true,
    created_at: now,
  };
  await db.insert(projects).values(row);
  return row as typeof projects.$inferSelect;
}

export async function listOrganizationsForUser(
  db: Db,
  userId: string,
  displayName?: string | null,
): Promise<OrganizationSummary[]> {
  await ensureDefaultOrganizationForUser(db, userId, displayName);

  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.owner_id, userId))
    .orderBy(asc(projects.created_at), asc(projects.id));

  return rows.map(toSummary);
}

export async function createOrganizationForUser(
  db: Db,
  userId: string,
  name: string,
  displayName?: string | null,
): Promise<OrganizationSummary> {
  await ensureDefaultOrganizationForUser(db, userId, displayName);

  const normalizedName = name.trim();
  const row: typeof projects.$inferInsert = {
    id: nanoid(),
    owner_id: userId,
    name: normalizedName,
    slug: await uniqueOrganizationSlug(db, normalizedName),
    is_default: false,
    created_at: new Date(),
  };

  await db.insert(projects).values(row);
  return toSummary(row as typeof projects.$inferSelect);
}

export async function getOrganizationBySlugForUser(
  db: Db,
  userId: string,
  slug: string,
): Promise<OrganizationSummary | null> {
  const rows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.owner_id, userId), eq(projects.slug, slug)))
    .limit(1);

  return rows[0] ? toSummary(rows[0]) : null;
}

export async function getDefaultOrganizationForUser(
  db: Db,
  userId: string,
  displayName?: string | null,
): Promise<OrganizationSummary> {
  const row = await ensureDefaultOrganizationForUser(db, userId, displayName);
  return toSummary(row);
}
