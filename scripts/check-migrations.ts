// SPDX-License-Identifier: AGPL-3.0-only
import { readdir, readFile } from "node:fs/promises"
import { basename, join } from "node:path"

type JournalEntry = {
  idx: number
  version: string
  when: number
  tag: string
  breakpoints: boolean
}

type Journal = {
  version: string
  dialect: string
  entries: JournalEntry[]
}

const ROOT = process.cwd()
const MIGRATIONS_DIR = join(ROOT, "packages/db/migrations")
const JOURNAL_PATH = join(MIGRATIONS_DIR, "meta/_journal.json")

// These two historical regressions are already deployed and cannot be repaired
// by rewriting migration history. New regressions are rejected.
const LEGACY_TIMESTAMP_REGRESSIONS = new Set([
  "0007_wave5_hooks_rotation",
  "0028_queue_trust",
])

function migrationPrefix(tag: string): number | null {
  const match = /^(\d{4})_/.exec(tag)
  return match ? Number(match[1]) : null
}

export function validateMigrationInventory(
  entries: JournalEntry[],
  sqlTags: string[],
): string[] {
  const errors: string[] = []
  const seenIndexes = new Set<number>()
  const seenTags = new Set<string>()
  const journalTags = new Set(entries.map((entry) => entry.tag))
  const sqlTagSet = new Set(sqlTags)

  for (let position = 0; position < entries.length; position++) {
    const entry = entries[position]!
    const prefix = migrationPrefix(entry.tag)

    if (!Number.isInteger(entry.idx) || entry.idx < 0) {
      errors.push(`invalid migration index for ${entry.tag}`)
    }
    if (prefix !== entry.idx) {
      errors.push(`tag ${entry.tag} does not match journal index ${entry.idx}`)
    }
    if (seenIndexes.has(entry.idx)) errors.push(`duplicate journal index ${entry.idx}`)
    if (seenTags.has(entry.tag)) errors.push(`duplicate journal tag ${entry.tag}`)
    seenIndexes.add(entry.idx)
    seenTags.add(entry.tag)

    const previous = entries[position - 1]
    if (previous && entry.idx <= previous.idx) {
      errors.push(`journal index ${entry.idx} is not ordered after ${previous.idx}`)
    }
    if (
      previous &&
      entry.when <= previous.when &&
      !LEGACY_TIMESTAMP_REGRESSIONS.has(entry.tag)
    ) {
      errors.push(
        `timestamp for ${entry.tag} must be newer than ${previous.tag}`,
      )
    }
  }

  for (const tag of journalTags) {
    if (!sqlTagSet.has(tag)) errors.push(`journal entry has no SQL file: ${tag}.sql`)
  }
  for (const tag of sqlTagSet) {
    if (!journalTags.has(tag)) errors.push(`SQL migration is missing from journal: ${tag}.sql`)
  }

  return errors
}

export async function checkMigrations(): Promise<{
  entries: number
  errors: string[]
}> {
  const journal = JSON.parse(await readFile(JOURNAL_PATH, "utf8")) as Journal
  const files = await readdir(MIGRATIONS_DIR)
  const sqlTags = files
    .filter((file) => file.endsWith(".sql"))
    .map((file) => basename(file, ".sql"))
    .sort()

  const errors: string[] = []
  if (journal.version !== "7") errors.push(`unsupported journal version ${journal.version}`)
  if (journal.dialect !== "postgresql") errors.push(`unexpected dialect ${journal.dialect}`)
  errors.push(...validateMigrationInventory(journal.entries, sqlTags))

  return { entries: journal.entries.length, errors }
}

if (import.meta.main) {
  const result = await checkMigrations()
  if (result.errors.length === 0) {
    console.log(`check-migrations: ${result.entries} journal entries OK`)
    process.exit(0)
  }

  console.error(`check-migrations: ${result.errors.length} violation(s)`)
  for (const error of result.errors) console.error(`  - ${error}`)
  process.exit(1)
}
