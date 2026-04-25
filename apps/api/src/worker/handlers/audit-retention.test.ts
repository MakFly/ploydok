// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test, mock } from "bun:test"
import {
  purgeOldAuditEntries,
  startAuditRetentionCron,
  stopAuditRetentionCron,
} from "./audit-retention"

function fakeDb(deletedRows: Array<{ id: number }>) {
  const where = mock(async () => deletedRows)
  const returning = mock(() => deletedRows) // for .where().returning() chain
  // Mimic Drizzle chaining: db.delete(...).where(...).returning(...)
  const chain = {
    where: mock(() => ({ returning: mock(() => deletedRows) })),
  }
  return {
    delete: mock(() => chain),
    _where: where,
    _returning: returning,
  }
}

describe("purgeOldAuditEntries", () => {
  test("calcule cutoff = now - retentionDays jours", async () => {
    const db = fakeDb([{ id: 1 }, { id: 2 }, { id: 3 }])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await purgeOldAuditEntries(db as any, 30)
    expect(r.deleted).toBe(3)
    expect(r.retentionDays).toBe(30)
    const expected = Date.now() - 30 * 86_400_000
    expect(Math.abs(r.cutoff.getTime() - expected)).toBeLessThan(2_000)
  })

  test("retentionDays par défaut = 30 (lit env)", async () => {
    const prev = Bun.env["PLOYDOK_AUDIT_RETENTION_DAYS"]
    delete Bun.env["PLOYDOK_AUDIT_RETENTION_DAYS"]
    const db = fakeDb([])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await purgeOldAuditEntries(db as any)
    expect(r.retentionDays).toBe(30)
    if (prev !== undefined) Bun.env["PLOYDOK_AUDIT_RETENTION_DAYS"] = prev
  })

  test("respecte PLOYDOK_AUDIT_RETENTION_DAYS env", async () => {
    Bun.env["PLOYDOK_AUDIT_RETENTION_DAYS"] = "7"
    const db = fakeDb([])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await purgeOldAuditEntries(db as any)
    expect(r.retentionDays).toBe(7)
    delete Bun.env["PLOYDOK_AUDIT_RETENTION_DAYS"]
  })

  test("fallback à 30 si env=0", async () => {
    Bun.env["PLOYDOK_AUDIT_RETENTION_DAYS"] = "0"
    const db = fakeDb([])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await purgeOldAuditEntries(db as any)
    expect(r.retentionDays).toBe(30)
    delete Bun.env["PLOYDOK_AUDIT_RETENTION_DAYS"]
  })

  test("fallback à 30 si env=-30", async () => {
    Bun.env["PLOYDOK_AUDIT_RETENTION_DAYS"] = "-30"
    const db = fakeDb([])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await purgeOldAuditEntries(db as any)
    expect(r.retentionDays).toBe(30)
    delete Bun.env["PLOYDOK_AUDIT_RETENTION_DAYS"]
  })

  test("fallback à 30 si env=abc", async () => {
    Bun.env["PLOYDOK_AUDIT_RETENTION_DAYS"] = "abc"
    const db = fakeDb([])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await purgeOldAuditEntries(db as any)
    expect(r.retentionDays).toBe(30)
    delete Bun.env["PLOYDOK_AUDIT_RETENTION_DAYS"]
  })

  test("clamp à 3650 si env=99999", async () => {
    Bun.env["PLOYDOK_AUDIT_RETENTION_DAYS"] = "99999"
    const db = fakeDb([])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await purgeOldAuditEntries(db as any)
    expect(r.retentionDays).toBe(3650)
    delete Bun.env["PLOYDOK_AUDIT_RETENTION_DAYS"]
  })
})

describe("startAuditRetentionCron", () => {
  test("démarre + stoppe sans crash", () => {
    const db = fakeDb([])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    startAuditRetentionCron({ db: db as any, intervalMs: 999_999_999 })
    stopAuditRetentionCron()
    expect(true).toBe(true)
  })

  test("stop est idempotent", () => {
    stopAuditRetentionCron()
    stopAuditRetentionCron()
    expect(true).toBe(true)
  })
})
