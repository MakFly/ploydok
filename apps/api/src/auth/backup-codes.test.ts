// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach } from "bun:test";
import { generate, consume, regenerate, countActive } from "./backup-codes";
import { users } from "@ploydok/db";
import type { Db } from "@ploydok/db";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { makeTestDb, TEST_PG_URL } from "../test/db-helpers";

const skip = !TEST_PG_URL;
if (skip) console.log("[backup-codes.test] PLOYDOK_TEST_PG_URL not set — skipping");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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
