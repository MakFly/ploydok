// SPDX-License-Identifier: AGPL-3.0-only
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import Redis from "ioredis"
import * as schema from "./schema"

export type Db = ReturnType<typeof createDb>

export function createDb(url: string): ReturnType<typeof drizzle<typeof schema>> {
  const sql = postgres(url, { max: 10, idle_timeout: 30 })
  return drizzle(sql, { schema })
}

export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null })
}
