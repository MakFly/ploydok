// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs"
import { describe, it, expect, beforeEach } from "bun:test"
import { generate, consume, regenerate, countActive } from "./backup-codes"
import { users, backup_codes } from "@ploydok/db"
import type { Db } from "@ploydok/db"
import { nanoid } from "nanoid"
import { eq } from "drizzle-orm"
import { makeTestDb, TEST_PG_URL } from "../test/db-helpers"

const skip = !TEST_PG_URL
if (skip)
  console.log("[backup-codes.test] PLOYDOK_TEST_PG_URL not set — skipping")

type StoredBackupCode = {
  id: string
  user_id: string
  code_hash: string
  consumed_at: Date | null
  created_at: Date
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function toStoredBackupCode(value: unknown): StoredBackupCode | null {
  if (
    !isRecord(value) ||
    typeof value["id"] !== "string" ||
    typeof value["user_id"] !== "string" ||
    typeof value["code_hash"] !== "string" ||
    !(value["created_at"] instanceof Date)
  ) {
    return null
  }

  return {
    id: value["id"],
    user_id: value["user_id"],
    code_hash: value["code_hash"],
    consumed_at:
      value["consumed_at"] instanceof Date ? value["consumed_at"] : null,
    created_at: value["created_at"],
  }
}

function buildFakeBackupDb(
  userId: string,
  opts: { forceEmptyConsumeUpdate?: boolean } = {}
) {
  const rows: StoredBackupCode[] = []
  const db = {
    insert: (table: unknown) => ({
      values: async (values: unknown) => {
        if (table !== backup_codes) return
        const items = Array.isArray(values) ? values : [values]
        for (const item of items) {
          const row = toStoredBackupCode(item)
          if (row) rows.push(row)
        }
      },
    }),
    select: () => {
      let table: unknown
      const chain = {
        from(nextTable: unknown) {
          table = nextTable
          return chain
        },
        where: async () =>
          table === backup_codes
            ? rows.filter(
                (row) => row.user_id === userId && row.consumed_at === null
              )
            : [],
      }
      return chain
    },
    update: (table: unknown) => ({
      set: (values: Partial<StoredBackupCode>) => ({
        where: () => ({
          returning: async () => {
            if (table !== backup_codes || opts.forceEmptyConsumeUpdate) {
              return []
            }
            const row = rows.find(
              (candidate) =>
                candidate.user_id === userId && candidate.consumed_at === null
            )
            if (!row) return []
            Object.assign(row, values)
            return [{ id: row.id }]
          },
        }),
      }),
    }),
  }

  return { db: db as unknown as Db, rows }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("backup-code security properties", () => {
  it("does not use Math.random for backup code generation", () => {
    const source = readFileSync(
      new URL("./backup-codes.ts", import.meta.url),
      "utf8"
    )
    expect(source).not.toContain("Math.random")
  })

  it("consumes a code only once", async () => {
    const userId = "fake-user"
    const { db } = buildFakeBackupDb(userId)
    const codes = await generate(db, userId)

    expect(await consume(db, userId, codes[0]!)).toBe(true)
    expect(await consume(db, userId, codes[0]!)).toBe(false)
  })

  it("treats an empty atomic update result as an already-used code", async () => {
    const userId = "raced-user"
    const { db } = buildFakeBackupDb(userId, {
      forceEmptyConsumeUpdate: true,
    })
    const codes = await generate(db, userId)

    expect(await consume(db, userId, codes[0]!)).toBe(false)
  })
})

describe.skipIf(skip)("backup-codes", () => {
  let db: Db;
  let userId: string;

  beforeEach(async () => {
    const result = await makeTestDb();
    db = result.db;
    userId = `bc-${nanoid(6)}`;
    const now = new Date();
    await db.insert(users).values({
      id: userId,
      email: `bc-${userId}@test.com`,
      display_name: "Test User",
      created_at: now,
      updated_at: now,
      recovery_token_hash: null,
      recovery_expires_at: null,
    }).onConflictDoNothing();
  });

  it("generate returns 10 unique codes", async () => {
    const codes = await generate(db, userId);
    expect(codes.length).toBe(10);
    const unique = new Set(codes);
    expect(unique.size).toBe(10);
  });

  it("codes have format XXXX-XXXX-XXXX", async () => {
    const codes = await generate(db, userId);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    }
  });

  it("consume returns true for a valid code", async () => {
    const codes = await generate(db, userId);
    const result = await consume(db, userId, codes[0]!);
    expect(result).toBe(true);
  });

  it("consume is one-shot — second use returns false", async () => {
    const codes = await generate(db, userId);
    await consume(db, userId, codes[0]!);
    const second = await consume(db, userId, codes[0]!);
    expect(second).toBe(false);
  });

  it("consume returns false for wrong code", async () => {
    await generate(db, userId);
    const result = await consume(db, userId, "ZZZZ-ZZZZ-ZZZZ");
    expect(result).toBe(false);
  });

  it("regenerate invalidates previous non-consumed codes and creates 10 new ones", async () => {
    const first = await generate(db, userId);
    const second = await regenerate(db, userId);

    // Old codes should no longer work
    const staleResult = await consume(db, userId, first[0]!);
    expect(staleResult).toBe(false);

    // New codes should work
    const newResult = await consume(db, userId, second[0]!);
    expect(newResult).toBe(true);
  });

  it("countActive reflects non-consumed codes", async () => {
    const codes = await generate(db, userId);
    const before = await countActive(db, userId);
    expect(before).toBe(10);

    // Consume one code
    await consume(db, userId, codes[0]!);
    const after = await countActive(db, userId);
    expect(after).toBe(9);
  });
});
