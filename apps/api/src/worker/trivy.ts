// SPDX-License-Identifier: AGPL-3.0-only
//
// Trivy image vulnerability scanning.
//
// Best-effort, same spirit as the agent's nvidia-smi GPU probe
// (agent/ploydok-agent/src/host_stats.rs): the `trivy` binary is optional on
// this host. A missing binary is a normal case (status "skipped"), not an
// error — callers must never let a scan failure block a deploy.
import { childLogger } from "../logger"

const log = childLogger("trivy")

const SCAN_TIMEOUT_MS = 180_000

export interface TrivySeverityCounts {
  critical: number
  high: number
  medium: number
  low: number
  unknown: number
}

export interface TrivyScanResult {
  status: "ok" | "skipped" | "failed"
  counts: TrivySeverityCounts
  error?: string
}

function zeroCounts(): TrivySeverityCounts {
  return { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isEnoent(err: unknown): boolean {
  return isRecord(err) && err["code"] === "ENOENT"
}

/**
 * Sum vulnerability counts per severity across all `Results[].Vulnerabilities`
 * entries of a `trivy image --format json` report. Tolerant of missing or
 * empty `Results` / `Vulnerabilities` arrays.
 */
export function parseTrivySeverityCounts(json: unknown): TrivySeverityCounts {
  const counts = zeroCounts()
  if (!isRecord(json)) return counts

  const results = json["Results"]
  if (!Array.isArray(results)) return counts

  for (const result of results) {
    if (!isRecord(result)) continue
    const vulnerabilities = result["Vulnerabilities"]
    if (!Array.isArray(vulnerabilities)) continue

    for (const vuln of vulnerabilities) {
      if (!isRecord(vuln)) continue
      const severity = vuln["Severity"]
      if (typeof severity !== "string") continue

      switch (severity.toUpperCase()) {
        case "CRITICAL":
          counts.critical += 1
          break
        case "HIGH":
          counts.high += 1
          break
        case "MEDIUM":
          counts.medium += 1
          break
        case "LOW":
          counts.low += 1
          break
        default:
          counts.unknown += 1
          break
      }
    }
  }

  return counts
}

/**
 * Scan `imageRef` with `trivy image`. Never throws:
 * - `trivy` binary absent (ENOENT) → `{ status: "skipped" }`, zeroed counts.
 * - non-zero exit, timeout, or unparsable output → `{ status: "failed" }`.
 * - otherwise → `{ status: "ok" }` with the parsed severity counts.
 *
 * Trivy's vulnerability DB cache (`~/.cache/trivy`) is intentionally left
 * enabled (no `--skip-db-update` / `--reset` flags) so repeat scans stay fast.
 */
export interface TrivyRegistryAuth {
  username: string
  password: string
}

export async function scanImage(
  imageRef: string,
  registryAuth?: TrivyRegistryAuth
): Promise<TrivyScanResult> {
  let proc: ReturnType<typeof Bun.spawn>
  try {
    proc = Bun.spawn(
      [
        "trivy",
        "image",
        "--quiet",
        "--format",
        "json",
        "--severity",
        "CRITICAL,HIGH,MEDIUM,LOW,UNKNOWN",
        imageRef,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        ...(registryAuth
          ? {
              env: {
                ...process.env,
                TRIVY_USERNAME: registryAuth.username,
                TRIVY_PASSWORD: registryAuth.password,
              },
            }
          : {}),
      }
    )
  } catch (err) {
    if (isEnoent(err)) {
      log.warn({ imageRef }, "trivy binary not found — skipping image scan")
      return { status: "skipped", counts: zeroCounts() }
    }
    return {
      status: "failed",
      counts: zeroCounts(),
      error: err instanceof Error ? err.message : String(err),
    }
  }

  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    proc.kill()
  }, SCAN_TIMEOUT_MS)

  let exitCode: number
  let stdout: string
  let stderr: string
  try {
    ;[exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
      new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
    ])
  } catch (err) {
    clearTimeout(timeout)
    return {
      status: "failed",
      counts: zeroCounts(),
      error: err instanceof Error ? err.message : String(err),
    }
  }
  clearTimeout(timeout)

  if (timedOut) {
    return {
      status: "failed",
      counts: zeroCounts(),
      error: `trivy scan timed out after ${SCAN_TIMEOUT_MS}ms`,
    }
  }

  if (exitCode !== 0) {
    return {
      status: "failed",
      counts: zeroCounts(),
      error:
        stderr.trim().slice(0, 500) || `trivy exited with code ${exitCode}`,
    }
  }

  try {
    const parsed: unknown = JSON.parse(stdout)
    return { status: "ok", counts: parseTrivySeverityCounts(parsed) }
  } catch (err) {
    return {
      status: "failed",
      counts: zeroCounts(),
      error: `failed to parse trivy output: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
