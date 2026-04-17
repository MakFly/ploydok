// SPDX-License-Identifier: AGPL-3.0-only

// ---------------------------------------------------------------------------
// GitHubCache — ETag-aware HTTP cache with 5-minute TTL
// ---------------------------------------------------------------------------

interface CacheEntry {
  etag: string | undefined;
  data: unknown;
  expiresAt: number;
}

export class GitHubCache {
  private store = new Map<string, CacheEntry>();

  /**
   * Fetch a URL with ETag caching.
   * - If a cached entry with a valid ETag exists, sends `If-None-Match`.
   * - On 304 Not Modified, returns the cached data with status 200.
   * - On 200, stores the new data + ETag.
   */
  async fetch(
    url: string,
    opts: RequestInit & { headers?: Record<string, string> },
  ): Promise<{ status: number; data: unknown }> {
    const entry = this.store.get(url);
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };

    if (entry?.etag && entry.expiresAt > Date.now()) {
      headers["If-None-Match"] = entry.etag;
    }

    const res = await fetch(url, { ...opts, headers });

    if (res.status === 304 && entry) {
      // Refresh TTL on hit
      this.store.set(url, { ...entry, expiresAt: Date.now() + 5 * 60 * 1000 });
      return { status: 200, data: entry.data };
    }

    const etag: string | undefined = res.headers.get("etag") ?? undefined;
    const data = await res.json();

    this.store.set(url, { etag, data, expiresAt: Date.now() + 5 * 60 * 1000 });

    return { status: res.status, data };
  }

  /**
   * Invalidate cache entries.
   * - If `pattern` is provided, removes all keys that include the pattern.
   * - If omitted, clears the entire cache.
   */
  invalidate(pattern?: string): void {
    if (!pattern) {
      this.store.clear();
      return;
    }
    for (const key of this.store.keys()) {
      if (key.includes(pattern)) {
        this.store.delete(key);
      }
    }
  }
}
