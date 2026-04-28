// SPDX-License-Identifier: AGPL-3.0-only
//
// ADR note: WebAuthn challenges are stored in-memory with a 5-minute TTL.
// This is acceptable for v1 (single-server deployment). In production with
// multiple replicas, replace with a distributed store (Redis, DB table).
// See project-docs/decisions/0002-auth-design.md for details.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChallengeEntry {
  challenge: string;
  expiresAt: number; // epoch ms
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const store = new Map<string, ChallengeEntry>();

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Periodic cleanup (every 60 s) — avoids unbounded memory growth
// ---------------------------------------------------------------------------

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.expiresAt <= now) {
      store.delete(key);
    }
  }
}, 60_000).unref(); // .unref() so it doesn't prevent process exit

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Store a challenge keyed by userId (or a temporary key for usernameless flows).
 */
export function setChallenge(key: string, challenge: string): void {
  store.set(key, {
    challenge,
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  });
}

/**
 * Retrieve and immediately delete a challenge (one-shot).
 * Returns null if expired or not found.
 */
export function consumeChallenge(key: string): string | null {
  const entry = store.get(key);
  if (!entry) return null;
  store.delete(key);
  if (entry.expiresAt <= Date.now()) return null;
  return entry.challenge;
}

/**
 * Peek without consuming (for debugging / tests).
 */
export function peekChallenge(key: string): string | null {
  const entry = store.get(key);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.challenge;
}
