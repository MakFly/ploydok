// SPDX-License-Identifier: AGPL-3.0-only
import { readFile } from "node:fs/promises"
import postgres from "postgres"

async function readDatabaseUrl(): Promise<string | null> {
  if (Bun.env.DATABASE_URL) return Bun.env.DATABASE_URL

  try {
    const envFile = await readFile("apps/api/.env.local", "utf8")
    for (const rawLine of envFile.split("\n")) {
      const line = rawLine.trim()
      if (!line || line.startsWith("#")) continue
      const match = line.match(/^DATABASE_URL=(.*)$/)
      if (!match) continue
      return match[1]?.replace(/^["']|["']$/g, "") ?? null
    }
  } catch {
    return null
  }

  return null
}

const databaseUrl = await readDatabaseUrl()

if (!databaseUrl) {
  console.error(
    "DATABASE_URL is required. Export it or define it in apps/api/.env.local."
  )
  process.exit(2)
}

const sql = postgres(databaseUrl, { max: 1 })

try {
  const brokenLinks = await sql`
    select
      l.id as link_id,
      l.app_id,
      a.name as app_name,
      l.database_id,
      d.name as database_name,
      l.env_prefix,
      case
        when a.id is null then 'missing_app'
        when d.id is null then 'missing_database'
        when a.project_id is distinct from d.project_id then 'cross_project'
        else 'ok'
      end as issue
    from app_db_links l
    left join apps a on a.id = l.app_id
    left join databases d on d.id = l.database_id
    where
      a.id is null
      or d.id is null
      or a.project_id is distinct from d.project_id
    order by l.created_at desc
  `

  if (brokenLinks.length === 0) {
    console.log("app_db_links audit: ok")
  } else {
    console.table(brokenLinks)
    process.exitCode = 1
  }
} finally {
  await sql.end()
}
