#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-only
import { Database } from "bun:sqlite"
import postgres from "postgres"
import { existsSync } from "node:fs"
import { parseArgs } from "node:util"

const { values } = parseArgs({
  options: {
    source: { type: "string", multiple: true, default: [] },
    "dry-run": { type: "boolean", default: false },
    apply: { type: "boolean", default: false },
  },
  strict: true,
})

const sources = (values.source as string[]).length
  ? (values.source as string[])
  : (["./ploydok.db"] as string[]).filter(existsSync)

if (sources.length === 0) {
  console.log("no source DB found, ok")
  process.exit(0)
}
if (!values["dry-run"] && !values["apply"]) {
  console.error("pass --dry-run or --apply")
  process.exit(1)
}

const pgUrl =
  process.env["DATABASE_URL"] ?? "postgres://ploydok:ploydok@localhost:5432/ploydok"
const sql = postgres(pgUrl)

// FK-respecting order:
const TABLES = [
  "users",
  "projects",
  "apps",
  "builds",
  "jobs",
  "job_runs",
  "domains",
  "env_vars",
  "secrets",
  "sessions",
  "passkeys",
  "backup_codes",
  "audit_log",
  "github_app",
] as const

type TableName = (typeof TABLES)[number]

const report: Record<TableName, { read: number; inserted: number; skipped: number }> = {} as never

for (const src of sources) {
  console.log(`\n## source: ${src}`)
  const db = new Database(src)

  for (const table of TABLES) {
    let rows: Record<string, unknown>[]
    try {
      rows = db.query(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]
    } catch {
      // Table may not exist in older SQLite schemas — skip silently.
      console.log(`[${table}] table not found, skipping`)
      continue
    }

    if (!report[table]) {
      report[table] = { read: 0, inserted: 0, skipped: 0 }
    }
    report[table].read += rows.length

    if (rows.length === 0) continue

    if (values["dry-run"]) {
      console.log(`[dry-run] ${table}: ${rows.length} rows, sample:`, rows.slice(0, 3))
      continue
    }

    // Batch 500, ON CONFLICT (id) DO NOTHING
    const BATCH = 500
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH).map(normalizeRow)
      try {
        await sql`INSERT INTO ${sql(table)} ${sql(batch)} ON CONFLICT (id) DO NOTHING`
        report[table].inserted += batch.length
      } catch (err) {
        console.error(`[${table}] batch ${i} failed:`, err)
        report[table].skipped += batch.length
      }
    }
  }

  db.close()
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  // SQLite unix timestamps (seconds or ms int) → Date for pg timestamptz
  for (const [k, v] of Object.entries(row)) {
    if (
      (k.endsWith("_at") ||
        k === "run_at" ||
        k === "started_at" ||
        k === "finished_at") &&
      typeof v === "number"
    ) {
      // Heuristic: values < 1e12 are seconds, >= 1e12 are milliseconds
      row[k] = new Date(v < 1e12 ? v * 1000 : v)
    }
  }
  return row
}

console.log("\n## report")
console.log(JSON.stringify(report, null, 2))
await sql.end()
