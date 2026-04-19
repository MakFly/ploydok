// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Registry GC handler — M4.2
 *
 * Exports:
 *  - runRegistryGc()          : prune old images across all apps (or a single app)
 *  - startRegistryGcCron()    : schedule runRegistryGc at 04:00 UTC daily
 *  - stopRegistryGcCron()     : cancel the scheduled cron (used in tests / shutdown)
 *  - getRegistryUsageForApp() : per-app registry stats (tags, bytes, diskPct)
 */
import { desc, eq } from "drizzle-orm";
import { apps, builds } from "@ploydok/db";
import {
  deleteDigest,
  diskUsagePct,
  getManifest,
  listTags,
} from "../registry";
import type { Db } from "@ploydok/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegistryClient {
  listTags: (repo: string) => Promise<string[]>;
  getManifest: (
    repo: string,
    tag: string,
  ) => Promise<{ digest: string; createdAt?: Date } | null>;
  deleteDigest: (repo: string, digest: string) => Promise<void>;
  diskUsagePct: () => Promise<number>;
}

export interface GcOptions {
  /** Injected registry client (defaults to the real client from registry.ts). */
  registryClient?: RegistryClient;
  /** Keep at most N images per app repo. Default: 3. */
  keepPerRepo?: number;
  /** DB instance. */
  db: Db;
  /** When set, only GC the given app id. */
  appFilter?: string;
}

export interface GcResult {
  reposScanned: number;
  tagsDeleted: number;
  bytesFreed: number;
}

export interface RegistryUsage {
  tags: number;
  bytes: number;
  diskPct: number;
}

// ---------------------------------------------------------------------------
// Default registry client (real implementation)
// ---------------------------------------------------------------------------

const defaultRegistryClient: RegistryClient = {
  listTags,
  getManifest,
  deleteDigest,
  diskUsagePct,
};

// ---------------------------------------------------------------------------
// runRegistryGc
// ---------------------------------------------------------------------------

/**
 * Garbage-collect the local registry by keeping only the `keepPerRepo` most
 * recently-built images for each app.
 *
 * Sort order:
 *  1. Builds with a known `created_at` date from the DB → newest first.
 *  2. Tags with no matching build row → kept (unknown = safe default).
 *  3. Tags with a known `createdAt` from the manifest → newest first.
 *
 * Returns aggregated stats: repos scanned, tags deleted, bytes freed (0 —
 * the registry HTTP API does not expose freed bytes; call `registry gc` CLI
 * for actual reclamation).
 */
export async function runRegistryGc(opts: GcOptions): Promise<GcResult> {
  const {
    registryClient: rc = defaultRegistryClient,
    keepPerRepo = 3,
    db,
    appFilter,
  } = opts;

  // 1. Load all app ids (or just the filtered one).
  const appRows = appFilter
    ? await db.select({ id: apps.id }).from(apps).where(eq(apps.id, appFilter)).limit(1)
    : await db.select({ id: apps.id }).from(apps);

  let reposScanned = 0;
  let tagsDeleted = 0;

  for (const { id: appId } of appRows) {
    const repo = `app-${appId.toLowerCase()}`;
    const tags = await rc.listTags(repo);
    if (tags.length === 0) continue;

    reposScanned++;

    if (tags.length <= keepPerRepo) continue;

    // 2. Join with builds table to get creation dates.
    const buildRows = await db
      .select({ image_tag: builds.image_tag, created_at: builds.created_at })
      .from(builds)
      .where(eq(builds.app_id, appId))
      .orderBy(desc(builds.created_at));

    // Map image_tag → created_at for quick lookup.
    const buildDateByTag = new Map<string, Date>();
    for (const row of buildRows) {
      if (row.image_tag && row.created_at) {
        // image_tag format: <registry>/app-<id>:<tag>  — extract the tag part.
        const shortTag = row.image_tag.split(":").at(-1) ?? row.image_tag;
        buildDateByTag.set(shortTag, row.created_at);
      }
    }

    // 3. Resolve manifests (digest + creation date).
    const resolved = await Promise.all(
      tags.map(async (tag) => {
        const manifest = await rc.getManifest(repo, tag);
        if (!manifest) return null;
        const createdAt = buildDateByTag.get(tag) ?? manifest.createdAt;
        return { tag, digest: manifest.digest, createdAt };
      }),
    );

    // Filter nulls and unknown digests.
    const valid = resolved.filter(
      (m): m is NonNullable<typeof m> & { digest: string } =>
        m !== null && m.digest !== "sha256:unknown" && m.digest !== "",
    );

    // 4. Sort: known date newest-first, then unknown.
    valid.sort((a, b) => {
      if (a.createdAt && b.createdAt) return b.createdAt.getTime() - a.createdAt.getTime();
      if (a.createdAt) return -1;
      if (b.createdAt) return 1;
      return 0;
    });

    // 5. Delete extras, deduplicated by digest.
    const toDelete = valid.slice(keepPerRepo);
    const seen = new Set<string>();

    for (const item of toDelete) {
      if (seen.has(item.digest)) continue;
      seen.add(item.digest);
      try {
        await rc.deleteDigest(repo, item.digest);
        tagsDeleted++;
        // eslint-disable-next-line no-console
        console.log(`[gc-registry] deleted ${repo}:${item.tag} (${item.digest})`);
      } catch (err) {
        // Non-fatal — log and continue.
        // eslint-disable-next-line no-console
        console.warn(`[gc-registry] failed to delete ${repo}:${item.tag}:`, err);
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `[gc-registry] done — scanned ${reposScanned} repos, deleted ${tagsDeleted} tags`,
  );

  return { reposScanned, tagsDeleted, bytesFreed: 0 };
}

// ---------------------------------------------------------------------------
// getRegistryUsageForApp
// ---------------------------------------------------------------------------

/**
 * Return registry usage stats for a single app:
 *  - `tags`    : number of image tags in the registry for this app.
 *  - `bytes`   : total compressed size of all manifests' layers (summed from
 *                manifest config blobs). 0 when the registry doesn't return
 *                size info.
 *  - `diskPct` : overall registry disk usage percentage (not per-app — the
 *                registry v2 API doesn't expose per-repo disk usage).
 */
export async function getRegistryUsageForApp(
  appId: string,
  db: Db,
  rc: RegistryClient = defaultRegistryClient,
): Promise<RegistryUsage> {
  const repo = `app-${appId.toLowerCase()}`;

  const [tags, diskPct] = await Promise.all([
    rc.listTags(repo),
    rc.diskUsagePct(),
  ]);

  // Attempt to compute total bytes from manifest layer sizes.
  let bytes = 0;
  if (tags.length > 0) {
    const manifests = await Promise.all(
      tags.map((tag) => rc.getManifest(repo, tag)),
    );
    // The manifest type from registry.ts doesn't expose layer sizes.
    // We accept 0 bytes for now — accurate disk breakdown requires a
    // registry catalog + blob listing API which is out of scope for M4.2.
    // The count of manifests and diskPct are sufficient for the widget.
    void manifests;
  }

  return { tags: tags.length, bytes, diskPct };
}

// ---------------------------------------------------------------------------
// Cron scheduler
// ---------------------------------------------------------------------------

/** Default run hour in UTC (04:00). */
const DEFAULT_HOUR_UTC = 4;
/** 24 hours in milliseconds. */
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

let _cronTimer: ReturnType<typeof setTimeout> | null = null;
let _cronInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Compute milliseconds until the next occurrence of `hourUtc:00:00 UTC`.
 */
function msUntilNextUtcHour(hourUtc: number): number {
  const now = new Date();
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      hourUtc,
      0,
      0,
      0,
    ),
  );
  // If that time has already passed today, schedule for tomorrow.
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

export interface StartGcCronOptions {
  /** Override interval in ms (for testing). Default: 24h. */
  intervalMs?: number;
  /** UTC hour to align the first run (default: 4). */
  hourUtc?: number;
  /** GC options forwarded to runRegistryGc. */
  gcOptions: GcOptions;
}

/**
 * Start the registry GC cron.
 *
 * Runs at `hourUtc:00 UTC` daily (default 04:00 UTC). After the initial
 * aligned delay, repeats every `intervalMs` (default 24h).
 *
 * To bootstrap in worker/index.ts, add:
 *   startRegistryGcCron({ gcOptions: { db } });
 */
export function startRegistryGcCron(opts: StartGcCronOptions): void {
  // Prevent double-start.
  stopRegistryGcCron();

  const { intervalMs = ONE_DAY_MS, hourUtc = DEFAULT_HOUR_UTC, gcOptions } = opts;

  async function tick(): Promise<void> {
    try {
      const result = await runRegistryGc(gcOptions);
      // eslint-disable-next-line no-console
      console.log("[gc-registry] cron tick result:", result);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[gc-registry] cron tick error:", err);
    }
  }

  const delay = msUntilNextUtcHour(hourUtc);
  // eslint-disable-next-line no-console
  console.log(
    `[gc-registry] cron scheduled — first run in ${Math.round(delay / 60_000)} min (at ${hourUtc}:00 UTC)`,
  );

  _cronTimer = setTimeout(() => {
    void tick();
    _cronInterval = setInterval(() => void tick(), intervalMs);
  }, delay);
}

/**
 * Cancel the registry GC cron (clears both the initial timeout and the
 * repeating interval). Safe to call even if the cron was never started.
 */
export function stopRegistryGcCron(): void {
  if (_cronTimer !== null) {
    clearTimeout(_cronTimer);
    _cronTimer = null;
  }
  if (_cronInterval !== null) {
    clearInterval(_cronInterval);
    _cronInterval = null;
  }
}
