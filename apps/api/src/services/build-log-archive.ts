// SPDX-License-Identifier: AGPL-3.0-only
import { readFile, unlink } from "node:fs/promises"
import { gunzipSync, gzipSync } from "node:zlib"
import type { Db } from "@ploydok/db"
import {
  getBuildById,
  setBuildLogArchive,
  markBuildLogPurged,
} from "@ploydok/db/queries"
import { childLogger } from "../logger"

const log = childLogger("build-log-archive")

export const MAX_RAW_LOG_BYTES = 50 * 1024 * 1024
const HEAD_TAIL_BYTES = 25 * 1024 * 1024

interface TruncationResult {
  content: Buffer
  truncated: boolean
  originalSize: number
}

export function truncateLog(raw: Buffer): TruncationResult {
  const originalSize = raw.length
  if (originalSize <= MAX_RAW_LOG_BYTES) {
    return { content: raw, truncated: false, originalSize }
  }
  const head = raw.subarray(0, HEAD_TAIL_BYTES)
  const tail = raw.subarray(raw.length - HEAD_TAIL_BYTES)
  const droppedMb = Math.round((originalSize - 2 * HEAD_TAIL_BYTES) / (1024 * 1024))
  const marker = Buffer.from(
    `\n\n[... TRUNCATED ${droppedMb} MB (kept first 25 MB and last 25 MB) ...]\n\n`,
    "utf8"
  )
  return {
    content: Buffer.concat([head, marker, tail]),
    truncated: true,
    originalSize,
  }
}

export interface CompressedArchive {
  archive: string
  rawSize: number
  compressedSize: number
}

export function compressLog(raw: Buffer): CompressedArchive {
  const { content, originalSize } = truncateLog(raw)
  const gz = gzipSync(content)
  return {
    archive: gz.toString("base64"),
    rawSize: originalSize,
    compressedSize: gz.length,
  }
}

export function decompressLog(archive: string): Buffer {
  return gunzipSync(Buffer.from(archive, "base64"))
}

/**
 * Read the log file at logPath, compress it, and persist into builds.log_archive.
 * Idempotent: skips if the build row already has log_archive set.
 * Returns true if archive was written, false if skipped (already archived,
 * already purged, or file missing).
 */
export async function archiveBuildLog(
  db: Db,
  buildId: string
): Promise<boolean> {
  const build = await getBuildById(db, buildId)
  if (!build) {
    log.warn({ buildId }, "archive skipped: build not found")
    return false
  }
  if (build.log_archive !== null) {
    log.debug({ buildId }, "archive skipped: already archived")
    return false
  }
  if (build.log_purged_at !== null) {
    log.debug({ buildId }, "archive skipped: already purged")
    return false
  }
  if (!build.log_path) {
    log.debug({ buildId }, "archive skipped: no log_path")
    return false
  }

  let raw: Buffer
  try {
    raw = await readFile(build.log_path)
  } catch (err) {
    log.warn(
      { buildId, logPath: build.log_path, err: (err as Error).message },
      "archive skipped: log file unreadable"
    )
    return false
  }

  if (raw.length === 0) {
    log.debug({ buildId }, "archive skipped: empty log file")
    return false
  }

  const { archive, rawSize, compressedSize } = compressLog(raw)
  await setBuildLogArchive(db, buildId, archive, rawSize, compressedSize)
  log.info(
    { buildId, rawSize, compressedSize, ratio: (rawSize / compressedSize).toFixed(1) },
    "build log archived"
  )
  return true
}

/**
 * Drop the archive bytes and rm the log file on disk. Keeps the build row
 * (status, commit_sha, finished_at) for historical UI.
 */
export async function purgeBuildLog(
  db: Db,
  buildId: string,
  logPath: string | null
): Promise<void> {
  if (logPath) {
    try {
      await unlink(logPath)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== "ENOENT") {
        log.warn(
          { buildId, logPath, err: (err as Error).message },
          "purge: unlink failed (continuing)"
        )
      }
    }
  }
  await markBuildLogPurged(db, buildId)
}
