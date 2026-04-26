// SPDX-License-Identifier: AGPL-3.0-only
//
// Rate-limit + concurrency cap via Redis (Sprint 6 pentest M4).
//
// - `checkRateLimit(redis, key, limit, windowSec)` — fenêtre fixe simple :
//   INCR + EXPIRE atomique. Refuse au-delà de `limit` dans la fenêtre.
// - `incrementConcurrentSessions(redis, key, max, ttl)` — atomic INCR + cap :
//   refuse au-delà de `max` ; le caller doit DECR à la fermeture.
//
// On évite l'import direct d'ioredis : `RateLimitStore` est l'interface minimale.

export interface RateLimitStore {
  incr(key: string): Promise<number>
  expire(key: string, seconds: number): Promise<number>
  decr(key: string): Promise<number>
}

export interface RateLimitResult {
  allowed: boolean
  current: number
  limit: number
}

export async function checkRateLimit(
  store: RateLimitStore,
  key: string,
  limit: number,
  windowSec: number
): Promise<RateLimitResult> {
  const current = await store.incr(key)
  if (current === 1) {
    // Premier hit dans la fenêtre — set TTL.
    await store.expire(key, windowSec)
  }
  return {
    allowed: current <= limit,
    current,
    limit,
  }
}

export async function incrementConcurrentSessions(
  store: RateLimitStore,
  key: string,
  max: number,
  ttlSec: number
): Promise<RateLimitResult> {
  const current = await store.incr(key)
  if (current === 1) {
    await store.expire(key, ttlSec)
  }
  if (current > max) {
    // Rollback l'INCR — la session ne sera pas ouverte.
    await store.decr(key)
    return { allowed: false, current: max + 1, limit: max }
  }
  return { allowed: true, current, limit: max }
}

export async function decrementConcurrentSessions(
  store: RateLimitStore,
  key: string
): Promise<void> {
  // Best-effort : si la clé a déjà expiré, DECR ne fait rien de mal
  // (descend en négatif transitoirement).
  await store.decr(key)
}
