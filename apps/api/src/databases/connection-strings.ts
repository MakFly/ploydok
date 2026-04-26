// SPDX-License-Identifier: AGPL-3.0-only

const DOCTRINE_POSTGRES_DEFAULTS: Record<string, string> = {
  serverVersion: "16",
  charset: "utf8",
}

export function normalizePostgresConnectionString(connString: string): string {
  const url = new URL(connString)

  for (const [key, value] of Object.entries(DOCTRINE_POSTGRES_DEFAULTS)) {
    if (!url.searchParams.has(key)) {
      url.searchParams.set(key, value)
    }
  }

  return url.toString()
}

export function normalizeLinkedDatabaseConnectionString(value: string): string {
  try {
    const url = new URL(value)
    if (url.protocol === "postgres:" || url.protocol === "postgresql:") {
      return normalizePostgresConnectionString(value)
    }
  } catch {
    return value
  }

  return value
}
