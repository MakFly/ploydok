// SPDX-License-Identifier: AGPL-3.0-only
//
// Domain queries — thin Drizzle wrappers for the domains MVP feature.
//
import { eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { domains } from "../schema"
import type { Db } from "../client"
import type { DomainRow } from "../schema"

export type { DomainRow }

export type TlsStatus = "pending" | "issued" | "failed"
export type TlsMode = "http01" | "dns01"

export interface DomainCreateOptions {
  tls_mode?: TlsMode
  dns01_provider?: string | null
  verify_token?: string | null
}

// ---------------------------------------------------------------------------
// listDomainsForApp
// ---------------------------------------------------------------------------

/**
 * Returns all custom domains for a given app, ordered by creation date ascending.
 */
export async function listDomainsForApp(db: Db, appId: string): Promise<DomainRow[]> {
  return db
    .select()
    .from(domains)
    .where(eq(domains.app_id, appId))
    .orderBy(domains.created_at)
}

// ---------------------------------------------------------------------------
// getDomain
// ---------------------------------------------------------------------------

/**
 * Returns a domain by its id, or null if not found.
 */
export async function getDomain(db: Db, domainId: string): Promise<DomainRow | null> {
  const rows = await db.select().from(domains).where(eq(domains.id, domainId)).limit(1)
  return rows[0] ?? null
}

// ---------------------------------------------------------------------------
// getDomainByHostname
// ---------------------------------------------------------------------------

/**
 * Returns a domain by its hostname (globally unique), or null if not found.
 * Used to check for hostname conflicts before insert.
 */
export async function getDomainByHostname(
  db: Db,
  hostname: string,
): Promise<DomainRow | null> {
  const rows = await db
    .select()
    .from(domains)
    .where(eq(domains.hostname, hostname))
    .limit(1)
  return rows[0] ?? null
}

// ---------------------------------------------------------------------------
// addDomain
// ---------------------------------------------------------------------------

/**
 * Inserts a new custom domain for an app with `tls_status = 'pending'`.
 * Callers must validate hostname format and check global uniqueness beforehand.
 */
export async function addDomain(
  db: Db,
  appId: string,
  hostname: string,
  opts: DomainCreateOptions = {},
): Promise<DomainRow> {
  const now = new Date()
  const id = nanoid()

  await db.insert(domains).values({
    id,
    app_id: appId,
    hostname,
    tls_status: "pending",
    tls_mode: opts.tls_mode ?? "http01",
    dns01_provider: opts.dns01_provider ?? null,
    verify_token: opts.verify_token ?? null,
    created_at: now,
    updated_at: now,
  })

  const rows = await db.select().from(domains).where(eq(domains.id, id)).limit(1)
  // Insert just succeeded — the row must be there.
  return rows[0] as DomainRow
}

// ---------------------------------------------------------------------------
// deleteDomain
// ---------------------------------------------------------------------------

/**
 * Deletes a domain by its id. Idempotent — no error if already gone.
 */
export async function deleteDomain(db: Db, domainId: string): Promise<void> {
  await db.delete(domains).where(eq(domains.id, domainId))
}

// ---------------------------------------------------------------------------
// updateDomainTlsStatus
// ---------------------------------------------------------------------------

/**
 * Updates the tls_status and updated_at for a domain.
 */
export async function updateDomainTlsStatus(
  db: Db,
  domainId: string,
  status: TlsStatus,
): Promise<DomainRow | null> {
  const now = new Date()
  await db
    .update(domains)
    .set({ tls_status: status, updated_at: now })
    .where(eq(domains.id, domainId))

  return getDomain(db, domainId)
}

// ---------------------------------------------------------------------------
// updateDomainDns01
// ---------------------------------------------------------------------------

export async function updateDomainDns01(
  db: Db,
  domainId: string,
  opts: { tls_mode: TlsMode; dns01_provider: string | null },
): Promise<DomainRow | null> {
  const now = new Date()
  await db
    .update(domains)
    .set({
      tls_mode: opts.tls_mode,
      dns01_provider: opts.dns01_provider,
      tls_status: "pending",
      updated_at: now,
    })
    .where(eq(domains.id, domainId))

  return getDomain(db, domainId)
}
