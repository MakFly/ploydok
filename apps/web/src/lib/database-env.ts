// SPDX-License-Identifier: AGPL-3.0-only

export type DatabaseEnvKind =
  | "postgres"
  | "mysql"
  | "mariadb"
  | "redis"
  | "mongo"
  | "libsql"

export const DEFAULT_DATABASE_ENV_PREFIX = "DATABASE"

const SQL_SUFFIXES = ["URL", "HOST", "PORT", "USER", "PASSWORD", "NAME"]
const REDIS_SUFFIXES = ["URL", "HOST", "PORT", "PASSWORD"]
const LIBSQL_SUFFIXES = ["URL", "HOST", "PORT", "USER", "PASSWORD"]

function normalizePrefix(prefix: string): string {
  return prefix.trim().toUpperCase() || DEFAULT_DATABASE_ENV_PREFIX
}

function generatedSuffixes(kind: DatabaseEnvKind | null): Array<string> {
  if (kind === "redis") return REDIS_SUFFIXES
  if (kind === "libsql") return LIBSQL_SUFFIXES
  return SQL_SUFFIXES
}

export function databaseEnvKeys(
  prefix: string,
  kind: DatabaseEnvKind | null = null
): Array<string> {
  const normalizedPrefix = normalizePrefix(prefix)
  return generatedSuffixes(kind).map(
    (suffix) => `${normalizedPrefix}_${suffix}`
  )
}

export function databaseEnvKeysForPrefix(
  prefix: string,
  kind: DatabaseEnvKind | null = null
): Set<string> {
  return new Set(databaseEnvKeys(prefix, kind))
}

function addKeysForPrefixes(
  keys: Set<string>,
  prefixes: Array<string>,
  suffixes: Array<string>
): void {
  for (const prefix of prefixes) {
    const normalizedPrefix = normalizePrefix(prefix)
    for (const suffix of suffixes) {
      keys.add(`${normalizedPrefix}_${suffix}`)
    }
  }
}

/**
 * Keys from repository .env files that must not be imported while a database
 * link is active. The database link owns connection credentials; importing old
 * local/dev DB values creates a confusing and sometimes broken mixed config.
 */
export function databaseEnvImportOmittedKeys(
  prefix: string,
  kind: DatabaseEnvKind | null = null
): Set<string> {
  const keys = new Set<string>()
  addKeysForPrefixes(keys, [prefix], generatedSuffixes(kind))

  switch (kind) {
    case "postgres":
      addKeysForPrefixes(
        keys,
        ["DATABASE", "DB", "POSTGRES", "PG"],
        ["URL", "HOST", "PORT", "USER", "PASSWORD", "NAME", "DATABASE"]
      )
      keys.add("PGHOST")
      keys.add("PGPORT")
      keys.add("PGUSER")
      keys.add("PGPASSWORD")
      keys.add("PGDATABASE")
      break
    case "mysql":
    case "mariadb":
      addKeysForPrefixes(
        keys,
        ["DATABASE", "DB", "MYSQL", "MARIADB"],
        ["URL", "HOST", "PORT", "USER", "PASSWORD", "NAME", "DATABASE"]
      )
      break
    case "redis":
      addKeysForPrefixes(keys, ["REDIS", "CACHE"], REDIS_SUFFIXES)
      break
    case "mongo":
      addKeysForPrefixes(
        keys,
        ["MONGO", "MONGODB"],
        ["URL", "HOST", "PORT", "USER", "PASSWORD", "NAME", "DATABASE"]
      )
      keys.add("MONGODB_URI")
      break
    case "libsql":
      addKeysForPrefixes(
        keys,
        ["LIBSQL", "TURSO"],
        [
          "URL",
          "HOST",
          "PORT",
          "USER",
          "PASSWORD",
          "DATABASE_URL",
          "AUTH_TOKEN",
        ]
      )
      break
    default:
      addKeysForPrefixes(keys, ["DATABASE", "DB"], SQL_SUFFIXES)
      break
  }

  return keys
}
