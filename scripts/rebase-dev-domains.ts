// SPDX-License-Identifier: AGPL-3.0-only
//
// One-shot migration — move dev app domains off the `.local` TLD.
//
// Apps created before this change got a default domain under
// `demo.ploydok.local`. On most Linux hosts `nsswitch.conf` routes any `.local`
// lookup to mDNS and stops there (`mdns4_minimal [NOTFOUND=return]`), so the
// name never reaches a DNS resolver and the app is unreachable from a browser
// even though Caddy serves it correctly. `.localhost` resolves to loopback with
// no resolver config at all, wildcards included.
//
// This is a script and not a drizzle migration on purpose: it rewrites data an
// operator may have chosen deliberately (`PLOYDOK_DOMAIN_BASE=demo.ploydok.local`
// is a legitimate setting), so it stays opt-in. Idempotent: re-running is safe.
//
// Usage:
//   set -a && . apps/api/.env.local && set +a
//   bun run scripts/rebase-dev-domains.ts           # dry run
//   bun run scripts/rebase-dev-domains.ts --apply
import postgres from "postgres"

const OLD_BASE = ".demo.ploydok.local"
const NEW_BASE = ".demo.localhost"

const DB_URL = Bun.env["DATABASE_URL"]
if (!DB_URL) {
  console.error("DATABASE_URL not set — source apps/api/.env.local first")
  process.exit(1)
}

const CADDY_ADMIN =
  Bun.env["PLOYDOK_CADDY_ADMIN_URL"] ?? "http://127.0.0.1:2020"
const apply = process.argv.includes("--apply")
const sql = postgres(DB_URL, { max: 2 })

type AppRow = { id: string; slug: string; domain: string }
type DomainRow = { id: string; app_id: string; hostname: string }

function rebase(hostname: string): string {
  return hostname.slice(0, -OLD_BASE.length) + NEW_BASE
}

async function patchCaddyHost(appId: string, hostname: string): Promise<void> {
  const res = await fetch(`${CADDY_ADMIN}/id/ploydok-${appId}/match/0/host`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([hostname]),
  })
  if (res.status === 404 || res.status === 500) {
    console.log(`    caddy: no route for ${appId}, skipped`)
    return
  }
  if (!res.ok) {
    throw new Error(`caddy PATCH ${res.status}: ${await res.text()}`)
  }
  console.log(`    caddy: route now matches ${hostname}`)
}

async function main(): Promise<void> {
  const appRows = await sql<Array<AppRow>>`
    SELECT id, slug, domain FROM apps
    WHERE domain LIKE ${"%" + OLD_BASE}
  `
  const domainRows = await sql<Array<DomainRow>>`
    SELECT id, app_id, hostname FROM domains
    WHERE hostname LIKE ${"%" + OLD_BASE}
  `

  if (appRows.length === 0 && domainRows.length === 0) {
    console.log(`Nothing to do — no hostname ends with ${OLD_BASE}.`)
    return
  }

  console.log(
    `${appRows.length} app domain(s) and ${domainRows.length} custom domain(s) to rebase${
      apply ? "" : " (dry run — pass --apply to write)"
    }\n`
  )

  for (const app of appRows) {
    const next = rebase(app.domain)
    console.log(`  ${app.slug}: ${app.domain} → ${next}`)
    if (!apply) continue
    await sql`UPDATE apps SET domain = ${next} WHERE id = ${app.id}`
    await patchCaddyHost(app.id, next)
  }

  for (const row of domainRows) {
    const next = rebase(row.hostname)
    console.log(`  domain ${row.hostname} → ${next}`)
    if (!apply) continue
    await sql`UPDATE domains SET hostname = ${next} WHERE id = ${row.id}`
  }

  if (apply) {
    console.log("\nDone. Redeploy each app to refresh anything else that")
    console.log("embeds the old hostname (build-time env, generated configs).")
  }
}

await main()
  .catch((err: unknown) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await sql.end()
  })
